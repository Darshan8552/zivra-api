import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
  ParseFilePipeBuilder,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MessagesService } from './messages.service';
import { SendMessageDto } from './dto/send-message.dto';
import { PaginateMessagesDto } from './dto/paginate-messages.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import type { SafeUser } from 'src/common/types/safe-user.types';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { MessageType } from 'src/generated/prisma/enums';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPE_REGEX = /^image\/(jpeg|png|webp|heic|heif)$/;

@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get()
  async list(
    @Param('conversationId', new ParseUUIDPipe({ version: '7' }))
    conversationId: string,
    @Query() dto: PaginateMessagesDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.messagesService.list(
      user.id,
      conversationId,
      dto.cursor,
      dto.limit,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async send(
    @Param('conversationId', new ParseUUIDPipe({ version: '7' }))
    conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.messagesService.send(user.id, conversationId, dto);
  }

  @Post('media')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  )
  async sendMedia(
    @Param('conversationId', new ParseUUIDPipe({ version: '7' }))
    conversationId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: ALLOWED_IMAGE_TYPE_REGEX })
        .addMaxSizeValidator({ maxSize: MAX_IMAGE_SIZE_BYTES })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
    @Body() body: { content?: string },
    @CurrentUser() user: SafeUser,
  ) {
    const asset = await this.cloudinary.uploadBuffer(
      file,
      `messages/${user.id}`,
    );
    return this.messagesService.send(user.id, conversationId, {
      type: MessageType.IMAGE,
      content: body?.content,
      mediaUrl: asset.url,
      mediaPublicId: asset.publicId,
    });
  }

  @Delete(':messageId')
  async remove(
    @Param('conversationId', new ParseUUIDPipe({ version: '7' }))
    _conversationId: string,
    @Param('messageId', new ParseUUIDPipe({ version: '7' })) messageId: string,
    @CurrentUser() user: SafeUser,
  ) {
    return this.messagesService.softDelete(user.id, messageId);
  }
}
