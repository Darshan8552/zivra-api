import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MessageType } from 'src/generated/prisma/enums';

export class SendMessageDto {
  @IsOptional()
  @IsEnum(MessageType)
  type?: MessageType;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  mediaPublicId?: string;

  @IsOptional()
  @IsUUID('7')
  sharedPostId?: string;

  @IsOptional()
  @IsUUID('7')
  sharedProfileUserId?: string;

  @IsOptional()
  @IsUUID('7')
  replyToMessageId?: string;
}
