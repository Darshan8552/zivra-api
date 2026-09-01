import { IsEnum, IsOptional } from 'class-validator';
import { StoryVisibility } from '../../generated/prisma/enums';

export class CreateStoryDto {
  @IsOptional()
  @IsEnum(StoryVisibility, {
    message: `visibility must be one of: ${Object.values(StoryVisibility).join(', ')}`,
  })
  visibility?: StoryVisibility;
}
