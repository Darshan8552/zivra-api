import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { OtpService } from '../services/otp.service';
import { TokensService } from '../services/tokens.service';
import { SignupDto } from './dto/signup.dto';
import { UsernameGeneratorUtil } from '../common/utils/username-generator.util';
import * as bcrypt from 'bcryptjs';
import { OtpPurpose, UserStatus } from '../generated/prisma/enums';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { PrismaService } from '../prisma/prisma.service';
import { SigninDto } from './dto/signin.dto';
import { DeviceInfo } from '../common/interfaces/device-info.interface';
import { SafeUser } from '../common/types/safe-user.types';
import { randomUUID } from 'node:crypto';
import { Tokens } from '../common/interfaces/tokens.interface';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { RefreshRequestPayload } from './strategies/refresh.strategy';
import { RedisService } from 'src/redis/redis.service';
import { RedisKeys } from 'src/common/utils/redis-keys';
import type { Request, Response } from 'express';
import { ExtractJwt } from 'passport-jwt';
import { clearAuthCookies } from 'src/common/utils/cookies.util';
import { cookieExtractor } from 'src/common/utils/jwt-extractor.util';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private redisService: RedisService,
    private tokensService: TokensService,
    private otpService: OtpService,
    private mailService: MailService,
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async signup(dto: SignupDto) {
    const existingUser = await this.usersService.findUserByEmail(dto.email);
    if (existingUser) {
      if (existingUser.status === UserStatus.SUSPENDED) {
        throw new ForbiddenException(
          'Your account has been restricted. Please contact support.',
        );
      }
      if (existingUser.emailVerifiedAt) {
        return { message: 'Account already verified. Please sign in.' };
      }
      const otp = await this.otpService.generateOtp(
        existingUser.id,
        existingUser.email,
        OtpPurpose.REGISTER,
      );
      await this.mailService.sendOtpEmail(
        existingUser.email,
        otp,
        existingUser.name,
        OtpPurpose.REGISTER,
      );
      return {
        message:
          'Account exists but email is unverified. A new OTP has been sent.',
      };
    }

    const username = UsernameGeneratorUtil.generateFromEmail(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.createUser({
      name: dto.name,
      email: dto.email,
      username,
      passwordHash,
      dateOfBirth: dto.dateOfBirth,
    });

    const otp = await this.otpService.generateOtp(
      user.id,
      user.email,
      OtpPurpose.REGISTER,
    );
    await this.mailService.sendOtpEmail(
      user.email,
      otp,
      user.name,
      OtpPurpose.REGISTER,
    );
    return {
      message:
        'OTP sent to your email. Please verify to activate your account.',
    };
  }

  async verifyEmail(
    dto: VerifyEmailDto,
    deviceInfo: DeviceInfo,
  ): Promise<{ user: SafeUser; tokens: Tokens }> {
    const { email, otp } = dto;
    await this.otpService.verifyOtp(email, otp, OtpPurpose.REGISTER);
    const user = await this.usersService.findUserByEmail(email);
    if (!user) throw new ConflictException('User not found');

    if (user.emailVerifiedAt) {
      throw new ConflictException('Email already verified');
    }

    const verifiedUser = await this.usersService.updateUser(user.id, {
      emailVerifiedAt: new Date(),
      status: UserStatus.ACTIVE,
    });

    return this.createSession(verifiedUser!, deviceInfo);
  }

  async signin(
    dto: SigninDto,
    deviceInfo: DeviceInfo,
  ): Promise<{ user: SafeUser; tokens: Tokens }> {
    const isLocked = await this.redisService.exists(
      RedisKeys.auth.loginLock(dto.identifier),
    );
    if (isLocked) {
      throw new ForbiddenException(
        'Account temporarily locked due to too many failed attempts. Try again later.',
      );
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: dto.identifier }, { username: dto.identifier }],
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      const fails = await this.redisService.incr(
        RedisKeys.auth.loginFailCount(dto.identifier),
      );
      await this.redisService.expire(
        RedisKeys.auth.loginFailCount(dto.identifier),
        3600,
      );
      if (fails >= 5) {
        await this.redisService.setEx(
          RedisKeys.auth.loginLock(dto.identifier),
          '1',
          900,
        );
      }
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('Your account has been restricted.');
    }

    if (!user.emailVerifiedAt) {
      throw new BadRequestException(
        'Please verify your email before signing in.',
      );
    }
    await this.redisService.del(RedisKeys.auth.loginFailCount(dto.identifier));
    const { passwordHash, ...safeUser } = user;
    return this.createSession(safeUser, deviceInfo);
  }

  async resendOtp(dto: ResendOtpDto): Promise<{ message: string }> {
    const user = await this.usersService.findUserByEmail(dto.email);
    if (dto.purpose === OtpPurpose.REGISTER) {
      if (!user) {
        throw new BadRequestException('No account found with this email.');
      }
      if (user.emailVerifiedAt) {
        return { message: 'Account already verified. Please sign in.' };
      }
      const otp = await this.otpService.generateOtp(
        user.id,
        user.email,
        OtpPurpose.REGISTER,
      );
      await this.mailService.sendOtpEmail(
        user.email,
        otp,
        user.name,
        OtpPurpose.REGISTER,
      );
      return { message: 'A new OTP has been sent to your email.' };
    }

    if (user && user.status !== UserStatus.SUSPENDED) {
      const otp = await this.otpService.generateOtp(
        user.id,
        user.email,
        OtpPurpose.FORGOT_PASSWORD,
      );
      await this.mailService.sendOtpEmail(
        user.email,
        otp,
        user.name,
        OtpPurpose.FORGOT_PASSWORD,
      );
    }
    return {
      message: 'If an account with this email exists, a new OTP has been sent.',
    };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const user = await this.usersService.findUserByEmail(dto.email);

    if (user && user.status === UserStatus.ACTIVE) {
      const otp = await this.otpService.generateOtp(
        user.id,
        user.email,
        OtpPurpose.FORGOT_PASSWORD,
      );
      await this.mailService.sendOtpEmail(
        user.email,
        otp,
        user.name,
        OtpPurpose.FORGOT_PASSWORD,
      );
    }

    return {
      message:
        'If an account with this email exists, a password reset OTP has been sent.',
    };
  }

  async verifyResetOtp(
    dto: VerifyResetOtpDto,
  ): Promise<{ resetToken: string }> {
    await this.otpService.verifyOtp(
      dto.email,
      dto.otp,
      OtpPurpose.FORGOT_PASSWORD,
    );

    const user = await this.usersService.findUserByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Unable to process this request.');
    }

    const resetToken = await this.tokensService.generateResetToken(
      user.id,
      user.email,
    );
    return { resetToken };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const payload = await this.tokensService.verifyResetToken(dto.resetToken);
    const user = await this.usersService.findUserByEmail(payload.email);
    if (!user || user.id !== payload.sub) {
      throw new UnauthorizedException('Invalid or expired reset token.');
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw new ForbiddenException(
        'Your account has been restricted. Please contact support.',
      );
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.usersService.updateUser(user.id, { passwordHash });
    await this.prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return {
      message:
        'Password has been reset successfully. Please sign in with your new password.',
    };
  }

  async refreshTokens(payload: RefreshRequestPayload): Promise<Tokens> {
    const session = await this.prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Session expired or revoked. Please sign in again.',
      );
    }

    const isValid = await this.tokensService.verifyRefreshToken(
      payload.refreshToken,
      session.refreshTokenHash,
    );
    if (!isValid) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Refresh token reuse detected. Please sign in again.',
      );
    }

    if (session.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your account is not active.');
    }

    const { passwordHash, ...safeUser } = session.user;
    const tokens = await this.tokensService.generateTokens(
      safeUser,
      session.id,
    );
    const refreshTokenHash = await this.tokensService.hashRefreshToken(
      tokens.refreshToken,
    );

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return tokens;
  }

  private async createSession(
    user: SafeUser,
    deviceInfo: DeviceInfo,
  ): Promise<{ user: SafeUser; tokens: Tokens }> {
    const sessionId = randomUUID();
    const tokens = await this.tokensService.generateTokens(user, sessionId);
    const refreshTokenHash = await this.tokensService.hashRefreshToken(
      tokens.refreshToken,
    );

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash,
        deviceId: deviceInfo.deviceId,
        deviceName: deviceInfo.deviceName,
        deviceType: deviceInfo.deviceType,
        userAgent: deviceInfo.userAgent,
        ipAddress: deviceInfo.ipAddress,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        lastUsedAt: new Date(),
      },
    });

    await this.usersService.updateUser(user.id, { lastLoginAt: new Date() });

    return { user, tokens };
  }

  async logout(req: Request, res: Response): Promise<{ message: string }> {
    const accessToken =
      ExtractJwt.fromAuthHeaderAsBearerToken()(req) ??
      cookieExtractor('access_token')(req);
    const refreshToken = cookieExtractor('refresh_token')(req);

    if (accessToken) {
      try {
        await this.tokensService.blacklistToken(accessToken);
      } catch {}
    }

    if (refreshToken) {
      try {
        const payload = await this.jwtService.verifyAsync<{
          sub: string;
          sessionId: string;
        }>(refreshToken, {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        });
        if (payload?.sessionId) {
          await this.prisma.session.updateMany({
            where: { id: payload.sessionId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      } catch {}
    }

    clearAuthCookies(res);
    return { message: 'Logged out successfully' };
  }
}
