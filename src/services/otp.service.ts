import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OtpPurpose } from '../generated/prisma/enums';
import * as bcrypt from 'bcryptjs';

const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class OtpService {
  constructor(private prisma: PrismaService) {}

  async generateOtp(
    userId: string | null,
    email: string,
    purpose: OtpPurpose,
  ): Promise<string> {
    const recentOtp = await this.prisma.otp.findFirst({
      where: {
        email,
        purpose,
        verifiedAt: null,
        createdAt: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentOtp) {
      const waitSeconds = Math.ceil(
        (OTP_RESEND_COOLDOWN_MS -
          (Date.now() - recentOtp.createdAt.getTime())) /
          1000,
      );
      throw new BadRequestException(
        `Please wait ${waitSeconds}s before requesting another OTP.`,
      );
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 12);

    await this.prisma.otp.create({
      data: {
        userId,
        email,
        otpHash,
        purpose,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    return otp;
  }

  async verifyOtp(
    email: string,
    otp: string,
    purpose: OtpPurpose,
  ): Promise<void> {
    const record = await this.prisma.otp.findFirst({
      where: {
        email,
        purpose,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      throw new BadRequestException('OTP expired or not found');
    }

    if (record.attemptCount >= 5) {
      throw new BadRequestException(
        'Too many failed attempts. Please request a new OTP.',
      );
    }

    const isValid = await bcrypt.compare(otp, record.otpHash);
    if (!isValid) {
      await this.prisma.otp.update({
        where: { id: record.id },
        data: { attemptCount: { increment: 1 } },
      });
      throw new BadRequestException('Invalid OTP');
    }

    await this.prisma.otp.update({
      where: { id: record.id },
      data: { verifiedAt: new Date() },
    });
  }
}
