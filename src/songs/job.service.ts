import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type SongJobStatus = 'processing' | 'done' | 'error';

export interface SongJob {
    id: string;
    status: SongJobStatus;
    progress: number;
    streamUrl?: string;
    error?: string;
}

export type SongJobStatusResponse =
    | { status: 'processing'; progress: number }
    | { status: 'done'; streamUrl: string }
    | { status: 'error'; error: string };

@Injectable()
export class JobService {
    private readonly jobs = new Map<string, SongJob>();

    createJob(): SongJob {
        const job: SongJob = {
            id: randomUUID(),
            status: 'processing',
            progress: 0,
        };

        this.jobs.set(job.id, job);
        return job;
    }

    getJob(jobId: string): SongJob | null {
        return this.jobs.get(jobId) ?? null;
    }

    updateJob(jobId: string, update: Partial<Omit<SongJob, 'id'>>): SongJob | null {
        const currentJob = this.jobs.get(jobId);

        if (!currentJob) {
            return null;
        }

        const nextJob: SongJob = {
            ...currentJob,
            ...update,
            progress: this.normalizeProgress(update.progress ?? currentJob.progress),
        };

        this.jobs.set(jobId, nextJob);
        return nextJob;
    }

    markDone(jobId: string, streamUrl: string): SongJob | null {
        return this.updateJob(jobId, {
            status: 'done',
            progress: 100,
            streamUrl,
            error: undefined,
        });
    }

    markError(jobId: string, error: string): SongJob | null {
        return this.updateJob(jobId, {
            status: 'error',
            error,
        });
    }

    toStatusResponse(job: SongJob): SongJobStatusResponse {
        if (job.status === 'done') {
            return {
                status: 'done',
                streamUrl: job.streamUrl ?? '',
            };
        }

        if (job.status === 'error') {
            return {
                status: 'error',
                error: job.error ?? 'Unknown job error',
            };
        }

        return {
            status: 'processing',
            progress: job.progress,
        };
    }

    private normalizeProgress(progress: number): number {
        return Math.max(0, Math.min(100, progress));
    }
}
