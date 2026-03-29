export type PlayResponseDto =
    | { type: 'ready'; streamUrl: string }
    | { type: 'job'; jobId: string };
