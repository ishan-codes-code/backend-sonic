import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SearchController } from './search.controller';
import { LastFmService } from '../../services/lastfm.service';

@Module({
  imports: [HttpModule],
  controllers: [SearchController],
  providers: [LastFmService],
})
export class SearchModule {}
