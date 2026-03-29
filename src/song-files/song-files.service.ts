import { Injectable, HttpException, HttpStatus, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { R2Service } from 'src/r2/r2.service';


const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpegStatic = require('ffmpeg-static');

@Injectable()
export class SongFilesService implements OnModuleInit {
    private readonly uploadsDir = path.join(process.cwd(), 'uploads');
    private ytDlpWrap: any;

    constructor(private readonly r2Service: R2Service) {
        fs.ensureDirSync(this.uploadsDir);
    }

    async onModuleInit() {
        const isWindows = os.platform() === 'win32';
        const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
        const binaryPath = path.join(process.cwd(), binaryName);

        if (!fs.existsSync(binaryPath)) {
            console.log('Downloading yt-dlp binary...');
            await YTDlpWrap.downloadFromGithub(binaryPath);
            if (!isWindows) {
                fs.chmodSync(binaryPath, '755');
            }
            console.log('yt-dlp downloaded successfully.');
        }

        this.ytDlpWrap = new YTDlpWrap(binaryPath);
    }

    async downloadAudio(videoId: string) {
        const url = `https://www.youtube.com/watch?v=${videoId}`
        // const filename = `${videoId}-${Date.now()}.mp3`
        const filename = `${videoId}.mp3`

        // Use a temporary file for more reliable extraction (ffmpeg often needs a seekable output for headers)
        const tempFilePath = path.join(os.tmpdir(), `${videoId}-${Date.now()}.mp3`)

        const ytDlpArgs = [
            url,
            '-f', 'ba/b',
            '-x',
            '--audio-format', 'mp3',
            '--ffmpeg-location', ffmpegStatic,
            '--no-check-certificate',
            '-4',
            '--js-runtimes', 'node',
            '--cache-dir', os.tmpdir(),
            '-o', tempFilePath,
        ]

        console.log(`Starting download for ${videoId} to ${tempFilePath}...`)

        try {
            // Execute download and extraction to the temporary file
            await this.ytDlpWrap.execPromise(ytDlpArgs)

            if (!fs.existsSync(tempFilePath)) {
                throw new Error('Extraction finished but output file was not found.')
            }

            console.log(`Extraction complete. Uploading ${tempFilePath} to R2...`)

            // Create a read stream from the finished file
            const fileStream = fs.createReadStream(tempFilePath)

            const key = await this.r2Service.uploadStream(fileStream, filename)

            // Cleanup the temporary file
            await fs.remove(tempFilePath).catch(err => console.warn('Failed to cleanup temp file:', err))

            return {
                success: true,
                r2Key: key,
            }
        } catch (err: any) {
            console.error('❌ Audio Download/Upload failed:', err.message)

            // Attempt cleanup if file exists
            if (fs.existsSync(tempFilePath)) {
                await fs.remove(tempFilePath).catch(() => { })
            }

            throw new HttpException(
                `Failed to process audio: ${err.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            )
        }
    }




}
