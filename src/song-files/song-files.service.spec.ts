import { Test, TestingModule } from '@nestjs/testing';
import { SongFilesService } from './song-files.service';

describe('SongFilesService', () => {
  let service: SongFilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SongFilesService],
    }).compile();

    service = module.get<SongFilesService>(SongFilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
