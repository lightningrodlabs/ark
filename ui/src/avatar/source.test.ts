import { describe, expect, it } from 'vitest';
import { avatarSource } from './source';

describe('avatarSource', () => {
  it('picks the profile avatar when the person has set one', () => {
    const result = avatarSource({ nickname: 'Alex', fields: { avatar: 'data:image/png;base64,xyz' } });
    expect(result).toEqual({ kind: 'avatar', url: 'data:image/png;base64,xyz' });
  });

  it('falls back to an identicon when the profile has no avatar field', () => {
    expect(avatarSource({ nickname: 'Alex', fields: {} })).toEqual({ kind: 'identicon' });
  });

  it('falls back to an identicon when the avatar field is empty', () => {
    expect(avatarSource({ nickname: 'Alex', fields: { avatar: '' } })).toEqual({ kind: 'identicon' });
  });

  it('falls back to an identicon when there is no profile at all (no client, or agent never set one)', () => {
    expect(avatarSource(undefined)).toEqual({ kind: 'identicon' });
    expect(avatarSource(null)).toEqual({ kind: 'identicon' });
  });
});
