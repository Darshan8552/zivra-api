import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SignupDto } from './dto/signup.dto';
import { AuthService } from './auth.service';
import type { Response, Request } from 'express';
import { VerifyEmailDto } from './dto/verify-email.dto';
import type { DeviceInfo } from '../common/interfaces/device-info.interface';
import { GetDeviceInfo } from '../common/decorators/device-info.decorator';
import { DeviceType } from '../generated/prisma/enums';
import { setAuthCookies } from '../common/utils/cookies.util';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { RefreshAuthGuard } from '../common/guards/refresh-auth.guard';
import type { RefreshRequestPayload } from './strategies/refresh.strategy';
import { SigninDto } from './dto/signin.dto';
import { GetRefreshPayload } from '../common/decorators/refresh-payload.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyResetOtpDto } from './dto/verify-reset-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { SafeUser } from '../common/types/safe-user.types';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() dto: SignupDto) {
    return await this.authService.signup(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @GetDeviceInfo() deviceInfo: DeviceInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.verifyEmail(
      dto,
      deviceInfo,
    );
    if (deviceInfo.deviceType !== DeviceType.WEB) {
      return { user, ...tokens };
    }
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  async signin(
    @Body() dto: SigninDto,
    @GetDeviceInfo() deviceInfo: DeviceInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.authService.signin(dto, deviceInfo);
    if (deviceInfo.deviceType !== DeviceType.WEB) {
      return { user, ...tokens };
    }
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { user };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @UseGuards(RefreshAuthGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @GetRefreshPayload() payload: RefreshRequestPayload,
    @GetDeviceInfo() deviceInfo: DeviceInfo,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.refreshTokens(payload);
    if (deviceInfo.deviceType !== DeviceType.WEB) {
      return tokens;
    }
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    return { message: 'Token refreshed successfully.' };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.authService.verifyResetOtp(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: SafeUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return await this.authService.logout(req, res);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(@CurrentUser() user: SafeUser) {
    return user;
  }
}
