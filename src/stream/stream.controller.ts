import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { StreamService } from './stream.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { GetCurrentUser } from 'src/common/decorators/get-current-user.decorator';



@Controller('stream')
export class StreamController {
    constructor(private readonly streamService: StreamService) { }

    @UseGuards(JwtAuthGuard)
    @Get(':songId')
    async getUrl(@GetCurrentUser('id') userId: string, @Param('songId') songId: string) {
        return this.streamService.getUrl(userId, songId);
    }


}





