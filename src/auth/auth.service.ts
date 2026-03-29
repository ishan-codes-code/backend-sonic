import { Injectable, UnauthorizedException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { SessionsService } from '../sessions/sessions.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) { }

  async signup(signupDto: SignupDto) {
    const existingUser = await this.usersService.findByEmail(signupDto.email);
    if (existingUser) {
      throw new BadRequestException('User with this email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(signupDto.password, salt);

    const newUser = await this.usersService.create({
      name: signupDto.name,
      email: signupDto.email,
      passwordHash,
    });

    return this.generateAuthParams(newUser.id, newUser.email);
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.generateAuthParams(user.id, user.email);
  }

  async refresh(refreshDto: RefreshDto) {
    let payloadSignature: any;
    try {
      payloadSignature = this.jwtService.verify(refreshDto.refreshToken, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
      });
    } catch (e) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const sessionId = payloadSignature?.sessionId;
    if (!sessionId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.sessionsService.findById(sessionId);
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }

    if (session.expiresAt < new Date()) {
      await this.sessionsService.delete(session.id);
      throw new UnauthorizedException('Refresh token expired');
    }

    const isRefreshTokenValid = await bcrypt.compare(refreshDto.refreshToken, session.refreshTokenHash);
    if (!isRefreshTokenValid) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findById(session.userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Rotates the refresh token
    await this.sessionsService.delete(session.id);
    return this.generateAuthParams(user.id, user.email);
  }

  async logout(sessionId: string) {
    if (!sessionId) return { message: 'Logged out successfully' };
    await this.sessionsService.delete(sessionId);
    return { message: 'Logged out successfully' };
  }

  private async generateAuthParams(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };

    const accessSecret = this.configService.get<string>('jwt.accessSecret');
    const accessExpiresIn = this.configService.get<string>('jwt.accessExpiresIn');

    const refreshSecret = this.configService.get<string>('jwt.refreshSecret');
    const refreshExpiresIn = this.configService.get<string>('jwt.refreshExpiresIn');

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: accessSecret,
      expiresIn: accessExpiresIn as any,
    });

    // Create a temporary session just to get an ID and reserve the row
    const sessionPlaceholder = await this.sessionsService.create({
      userId,
      refreshTokenHash: 'placeholder',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // Default 30 days
    });

    // Sign refresh token with session ID injected
    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, email, sessionId: sessionPlaceholder.id },
      { secret: refreshSecret, expiresIn: refreshExpiresIn as any }
    );

    // Hash it
    const salt = await bcrypt.genSalt(10);
    const refreshTokenHash = await bcrypt.hash(refreshToken, salt);

    // Decode to get exactly when the refresh token will expire
    const decodedRefresh = this.jwtService.decode(refreshToken) as any;
    const expiresAt = new Date(decodedRefresh.exp * 1000);

    // Update real session.
    // Drizzle doesn't have an update method implemented in our service yet.
    // Let's implement an update method or rewrite delete + create.
    // Instead of update, I can just delete and recreate real fast.
    await this.sessionsService.delete(sessionPlaceholder.id);
    await this.sessionsService.create({
      id: sessionPlaceholder.id, // specify the same ID
      userId,
      refreshTokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
    };
  }
}
