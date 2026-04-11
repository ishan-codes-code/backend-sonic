import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { LastFmService } from '../../services/lastfm.service';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

@Module({
  imports: [HttpModule],
  controllers: [DiscoveryController],
  providers: [LastFmService, DiscoveryService],
})
export class DiscoveryModule {}
