import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;
const WEBSITE_REGEX = /^(https?:\/\/)?[^\s/$.?#][^\s]*\.[^\s]+$/i;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @Matches(USERNAME_REGEX, {
    message:
      'Username must be 3-30 characters: lowercase letters, numbers, and underscores only',
  })
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ValidateIf((o: UpdateProfileDto) => !!o.website)
  @Matches(WEBSITE_REGEX, { message: 'Website must be a valid URL' })
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @IsOptional()
  @Transform(
    ({ value, obj, key }: { value: unknown; obj: unknown; key: string }) => {
      const raw = (obj as Record<string, unknown>)?.[key] ?? value;
      if (raw === 'true' || raw === true) return true;
      if (raw === 'false' || raw === false) return false;
      if (raw === '') return undefined;
      if (value === 'true') return true;
      if (value === 'false') return false;
      if (value === '') return undefined;
      return value;
    },
  )
  @IsBoolean()
  isPrivate?: boolean;
}
