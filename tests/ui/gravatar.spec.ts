// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settings } from 'src/context/sharedSettingsContext';
import { DEFAULT_SETTINGS } from 'src/settings/setting';
import {
  DEFAULT_GRAVATAR,
  firstEmail,
  GravatarSettings as Gravatar,
  gravatarHash,
  gravatarUrl,
  normalizeGravatar,
} from 'src/ui/avatar/gravatar';
import { Avatar } from 'src/ui/sidebar/components/elements/Avatar';
import { GravatarSettings } from 'src/ui/settings/components/gravatarSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** SHA-256 of "test@example.com". */
const HASH = '973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b';

describe('gravatar', () => {
  it('hashes the trimmed, lower-case address with SHA-256', async () => {
    expect(await gravatarHash(' Test@Example.com ')).toBe(HASH);
  });

  it('asks for a 404 with initials, so the card shows its own initials', () => {
    expect(gravatarUrl(HASH, 200, 'initials')).toBe(`https://gravatar.com/avatar/${HASH}?s=200&d=404&r=g`);
    expect(gravatarUrl(HASH, 200, 'robohash')).toBe(`https://gravatar.com/avatar/${HASH}?s=200&d=robohash&r=g`);
  });

  it('takes the first email address of a contact', () => {
    expect(firstEmail({ FN: 'A', 'EMAIL[HOME]': ' a@b.nl ', 'EMAIL[WORK]': 'w@b.nl' })).toBe('a@b.nl');
    expect(firstEmail({ 'EMAIL[HOME]': '', EMAIL: 'x@y.nl' })).toBe('x@y.nl');
    expect(firstEmail({ FN: 'A' })).toBeUndefined();
  });

  it('is off by default and keeps only known fallbacks', () => {
    expect(normalizeGravatar(undefined)).toEqual(DEFAULT_GRAVATAR);
    expect(DEFAULT_GRAVATAR.enabled).toBe(false);
    expect(normalizeGravatar({ enabled: true, fallback: 'retro' })).toEqual({ enabled: true, fallback: 'retro' });
    expect(normalizeGravatar({ enabled: 'yes', fallback: 'kitten' })).toEqual(DEFAULT_GRAVATAR);
  });
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  settings.value = undefined;
});

function useGravatar(gravatar: Gravatar) {
  settings.value = { ...DEFAULT_SETTINGS, gravatar };
}

async function renderAvatar(props: Partial<React.ComponentProps<typeof Avatar>>) {
  await act(async () => {
    root.render(React.createElement(Avatar, { firstName: 'Test', lastName: 'Person', functionalName: 'Test Person', ...props }));
  });
  // Let the hash finish and the image show.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const img = () => container.querySelector('img');
const initials = () => container.querySelector('svg text')?.textContent;

describe('the card avatar', () => {
  it('shows initials when Gravatar is off', async () => {
    useGravatar({ enabled: false, fallback: 'initials' });
    await renderAvatar({ email: 'test@example.com' });
    expect(img()).toBeNull();
    expect(initials()).toBe('TP');
  });

  it('shows the Gravatar of a contact without a photo', async () => {
    useGravatar({ enabled: true, fallback: 'identicon' });
    await renderAvatar({ email: 'test@example.com' });
    expect(img()?.getAttribute('src')).toBe(`https://gravatar.com/avatar/${HASH}?s=200&d=identicon&r=g`);
    expect(img()?.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('keeps the photo of a contact that has one', async () => {
    useGravatar({ enabled: true, fallback: 'initials' });
    await renderAvatar({ email: 'test@example.com', photoUrl: 'https://photos.example/p.jpg' });
    expect(img()?.getAttribute('src')).toBe('https://photos.example/p.jpg');
  });

  it('shows the initials when there is no Gravatar', async () => {
    useGravatar({ enabled: true, fallback: 'initials' });
    await renderAvatar({ email: 'test@example.com' });
    act(() => {
      img()!.dispatchEvent(new Event('error'));
    });
    expect(img()).toBeNull();
    expect(initials()).toBe('TP');
  });

  it('shows the initials of a contact without an email address', async () => {
    useGravatar({ enabled: true, fallback: 'robohash' });
    await renderAvatar({});
    expect(img()).toBeNull();
    expect(initials()).toBe('TP');
  });
});

describe('the Gravatar settings', () => {
  it('switches Gravatar on, and offers the fallbacks only when it is on', async () => {
    useGravatar(DEFAULT_GRAVATAR);
    act(() => root.render(React.createElement(GravatarSettings)));
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Without a Gravatar"]')!;
    expect(select.disabled).toBe(true);
    expect([...select.options].map((option) => option.textContent)).toContain('Initials');
    expect(container.querySelector('[role="switch"][aria-label="Gravatar"]')?.getAttribute('aria-checked')).toBe('false');
  });
});
