import { Injectable } from '@nestjs/common';
import { BrevoClient } from '@getbrevo/brevo';
import { ConfigService } from '@nestjs/config';
import { OtpPurpose } from '../generated/prisma/enums';

const OTP_EMAIL_COPY: Record<
  OtpPurpose,
  { subject: string; heading: string; body: string }
> = {
  [OtpPurpose.REGISTER]: {
    subject: 'Verify your email - Pulse',
    heading: 'Welcome to Pulse!',
    body: 'Your verification code is:',
  },
  [OtpPurpose.FORGOT_PASSWORD]: {
    subject: 'Reset your password - Pulse',
    heading: 'Reset your password',
    body: "Use the code below to reset your password. If you didn't request this, you can safely ignore this email.",
  },
  [OtpPurpose.LOGIN]: {
    subject: 'Your sign-in code - Pulse',
    heading: 'Sign-in verification',
    body: 'Your one-time sign-in code is:',
  },
  [OtpPurpose.CHANGE_EMAIL]: {
    subject: 'Confirm your new email - Pulse',
    heading: 'Confirm your new email',
    body: 'Your confirmation code is:',
  },
};

@Injectable()
export class MailService {
  private brevo: BrevoClient;

  constructor(private readonly configService: ConfigService) {
    const apiKey = configService.get<string>('BREVO_API_KEY');
    if (!apiKey) {
      throw new Error(
        'BREVO_API_KEY is missing from environment configuration.',
      );
    }

    this.brevo = new BrevoClient({ apiKey });
  }

  async sendOtpEmail(
    email: string,
    otp: string,
    name: string,
    purpose: OtpPurpose = OtpPurpose.REGISTER,
  ) {
    const copy = OTP_EMAIL_COPY[purpose];
    try {
      await this.brevo.transactionalEmails.sendTransacEmail({
        subject: copy.subject,
        htmlContent: `
                              <div style="font-family: sans-serif;">
                                <h1>${copy.heading}</h1>
                                <p>Hi ${name},</p>
                                <p>${copy.body}</p>
                                <h2 style="letter-spacing: 2px; background: #f4f4f4; padding: 10px; display: inline-block;">${otp}</h2>
                                <p>This code expires in 10 minutes.</p>
                              </div>
                            `,
        sender: {
          name: this.configService.get<string>('BREVO_SENDER_NAME'),
          email: this.configService.get<string>('BREVO_SENDER_EMAIL'),
        },
        to: [{ email, name }],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to send email via Brevo: ${msg}`);
    }
  }
}
