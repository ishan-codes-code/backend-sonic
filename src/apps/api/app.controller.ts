import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { GetCurrentUser } from '../../infrastructure/common/decorators/get-current-user.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('protected')
  @UseGuards(JwtAuthGuard)
  getProtectedData(@GetCurrentUser() user: any) {
    return {
      message: 'You have accessed a protected route!',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
    };
  }
}
