import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class StoryFeedQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value !== undefined && value !== '' ? parseInt(String(value), 10) : undefined,
  )
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
