import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

function parseArrayField(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map(String);

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }

  return undefined;
}

function parseBooleanField(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }

  return value as boolean;
}

export class CreatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  locationName?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseFloat(value) : undefined,
  )
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseFloat(value) : undefined,
  )
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Transform(({ value }) => parseBooleanField(value))
  @IsBoolean()
  allowComments?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseBooleanField(value))
  @IsBoolean()
  allowLikes?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseBooleanField(value))
  @IsBoolean()
  allowShare?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseArrayField(value))
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  hashtags?: string[];

  @IsOptional()
  @Transform(({ value }) => parseArrayField(value))
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  taggedUserIds?: string[];
}
