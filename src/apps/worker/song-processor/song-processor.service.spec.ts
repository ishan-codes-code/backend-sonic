import { Test, TestingModule } from '@nestjs/testing';
import { SongProcessorService } from './song-processor.service';

describe('SongProcessorService', () => {
  let service: SongProcessorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SongProcessorService],
    }).compile();

    service = module.get<SongProcessorService>(SongProcessorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
