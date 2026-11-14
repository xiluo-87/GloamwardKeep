import { describe, expect, it } from 'vitest';
import { build } from '../src/sim/actions';
import { defaultView } from '../src/render/view';
import { mk, freeTiles } from './helpers';
import { Session } from '../src/ui/session';

function selectedArcher(): { session: Session; state: ReturnType<typeof mk> } {
  const state = mk();
  const [col, row] = freeTiles(state, () => true)[0];
  const tower = build(state, 'archer', col, row);
  if (!tower) throw new Error('Expected archer build to succeed.');
  const session = new Session();
  session.run = state;
  session.view = defaultView();
  session.selectTile(col, row);
  return { session, state };
}

describe('upgrade range preview state', () => {
  it('records only a valid selected tower option without mutating the run', () => {
    const { session, state } = selectedArcher();
    const tower = session.selected!;
    const before = { gold: state.gold, tier: tower.tier, range: tower.stats.range };

    session.previewBuild('archer');
    expect(session.view.placing).toBe('archer');
    session.previewUpgrade('tier');

    expect(session.view.upgradePreview).toEqual({ uid: tower.uid, path: 'tier' });
    expect(session.view.placing).toBeNull();
    expect(session.view.routePreview).toBeNull();
    expect({ gold: state.gold, tier: tower.tier, range: tower.stats.range }).toEqual(before);
    session.previewUpgrade('b');
    expect(session.view.upgradePreview).toBeNull();
  });

  it('clears on overlay close and after the upgrade action', () => {
    const { session } = selectedArcher();
    const uid = session.selected!.uid;

    session.previewUpgrade('tier');
    session.closeOverlays();
    expect(session.view.upgradePreview).toBeNull();

    session.previewUpgrade('tier');
    expect(session.upgradeSelected()).toBe(true);
    expect(session.view.upgradePreview).toBeNull();
    expect(session.run!.towers.find(t => t.uid === uid)!.tier).toBe(2);
  });
});
