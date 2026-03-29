import { Test, TestingModule } from '@nestjs/testing';
import { R2Controller } from './r2.controller';

describe('R2Controller', () => {
  let controller: R2Controller;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [R2Controller],
    }).compile();

    controller = module.get<R2Controller>(R2Controller);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
