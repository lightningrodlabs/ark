/**
 * The `@holochain-open-dev/profiles` Profile shape this module cares about.
 * Only the pieces `avatarSource` reads, so callers can pass an
 * `EntryRecord<Profile>['entry']` straight through.
 */
export interface ProfileLike {
  nickname?: string;
  fields: Record<string, string>;
}

export type AvatarSource = { kind: 'avatar'; url: string } | { kind: 'identicon' };

/**
 * Decides whether an agent's avatar should be their profile picture or a
 * generated identicon. Pure so it is unit-testable without a profiles client
 * or a DOM: no profile, no avatar field, or an empty avatar field all fall
 * back to the identicon — which is also the only option available outside
 * Moss, where there is no profiles client at all.
 */
export function avatarSource(profile: ProfileLike | null | undefined): AvatarSource {
  const avatar = profile?.fields.avatar;
  return avatar ? { kind: 'avatar', url: avatar } : { kind: 'identicon' };
}
