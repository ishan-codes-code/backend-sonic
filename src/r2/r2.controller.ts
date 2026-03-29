import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { R2Service } from './r2.service';
import { FileInterceptor } from '@nestjs/platform-express'

@Controller('r2')
export class R2Controller {
    constructor(private readonly r2Service: R2Service) { }

    @Post('upload-test')
    @UseInterceptors(FileInterceptor('file'))
    async uploadTest(@UploadedFile() file: Express.Multer.File) {
        return this.r2Service.uploadFile(file)
    }
}
