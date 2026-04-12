import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from '../../infrastructure/common/guards/jwt-auth.guard';
import { GetCurrentUser } from '../../infrastructure/common/decorators/get-current-user.decorator';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) { }

  @Post('signup')
  async signup(@Body() signupDto: SignupDto) {
    return this.authService.signup(signupDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('refresh')
  async refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refresh(refreshDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Body() refreshDto: RefreshDto) {
    // We decode the refresh token to get the session ID
    let decoded: any;
    try {
      decoded = this.jwtService.decode(refreshDto.refreshToken);
    } catch (e) {
      return { message: 'Logged out successfully' };
    }

    if (decoded && decoded.sessionId) {
      return this.authService.logout(decoded.sessionId);
    }
    return { message: 'Logged out successfully' };
  }
}
