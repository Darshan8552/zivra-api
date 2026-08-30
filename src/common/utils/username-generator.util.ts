import { randomBytes } from 'node:crypto';

export class UsernameGeneratorUtil {
  static generateFromEmail(email: string): string {
    const baseUsername = email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .slice(0, 20);

    const suffix = randomBytes(3).toString('hex');

    return `${baseUsername}_${suffix}`;
  }

  static isAvailable(username: string, existingUsername: string[]): boolean {
    return !existingUsername.includes(username);
  }
}
