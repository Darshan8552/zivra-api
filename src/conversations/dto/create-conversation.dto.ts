import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsUUID,
  IsOptional,
  IsString,
  MaxLength,
  IsEnum,
} from 'class-validator';
import { ConversationType } from 'src/generated/prisma/enums';

export class CreateConversationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @IsUUID('7', { each: true })
  participantIds!: string[];

  @IsOptional()
  @IsEnum(ConversationType)
  type?: ConversationType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}
