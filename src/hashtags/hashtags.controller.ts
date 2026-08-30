import { Controller, Get, Query } from '@nestjs/common';
import { HashtagsService } from './hashtags.service';
import { SuggestHashtagsDto } from './dto/suggest-hashtags.dto';

@Controller('hashtags')
export class HashtagsController {
  constructor(private readonly hashtagsService: HashtagsService) {}

  @Get('suggestions')
  async suggestions(@Query() dto: SuggestHashtagsDto) {
    return await this.hashtagsService.suggestions(dto.q, dto.limit);
  }
}
