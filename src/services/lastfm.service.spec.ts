import { pickLastFmBestArtworkUrl } from './lastfm.service';

describe('pickLastFmBestArtworkUrl', () => {
  it('returns null for undefined/null/empty', () => {
    expect(pickLastFmBestArtworkUrl(undefined)).toBeNull();
    expect(pickLastFmBestArtworkUrl(null)).toBeNull();
    expect(pickLastFmBestArtworkUrl([])).toBeNull();
  });

  it('returns null for empty/whitespace URLs', () => {
    expect(
      pickLastFmBestArtworkUrl([
        { '#text': '' },
        { '#text': '   ' },
        { '#text': '\n\t' },
      ]),
    ).toBeNull();
  });

  it('filters out the Last.fm placeholder image hash', () => {
    expect(
      pickLastFmBestArtworkUrl([
        {
          '#text': `https://lastfm.freetls/${'2a96cbd8b46e442fc41c2b86b821562f'}.png`,
        },
      ]),
    ).toBeNull();
  });

  it('picks the highest-quality non-placeholder image', () => {
    expect(
      pickLastFmBestArtworkUrl([
        { '#text': 'https://img/medium.png', size: 'medium' },
        { '#text': 'https://img/large.png', size: 'large' },
        {
          '#text':
            'https://lastfm.placeholder/2a96cbd8b46e442fc41c2b86b821562f.png',
          size: 'extralarge',
        },
      ]),
    ).toBe('https://img/large.png');
  });

  it('returns the last non-empty URL when all are valid', () => {
    expect(
      pickLastFmBestArtworkUrl([
        { '#text': 'https://img/small.png', size: 'small' },
        { '#text': 'https://img/mega.png', size: 'mega' },
      ]),
    ).toBe('https://img/mega.png');
  });
});
