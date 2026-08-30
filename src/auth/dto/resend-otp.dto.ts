import { IsEmail, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
import { OtpPurpose } from '../../generated/prisma/enums';

export const RESENDABLE_OTP_PURPOSES = [
  OtpPurpose.REGISTER,
  OtpPurpose.FORGOT_PASSWORD,
] as const;

export type ResendableOtpPurpose = (typeof RESENDABLE_OTP_PURPOSES)[number];

export class ResendOtpDto {
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  email: string;

  @IsIn(RESENDABLE_OTP_PURPOSES)
  purpose: ResendableOtpPurpose;
}
