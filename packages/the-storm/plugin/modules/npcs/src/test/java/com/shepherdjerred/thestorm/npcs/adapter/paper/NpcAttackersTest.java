package com.shepherdjerred.thestorm.npcs.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.bukkit.damage.DamageSource;
import org.bukkit.entity.Arrow;
import org.bukkit.entity.Player;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.junit.jupiter.api.Test;

final class NpcAttackersTest {
  @Test
  void arrowsAndPrimedTntIdentifyTheirLivingSource() {
    var player = mock(Player.class);
    var arrow = mock(Arrow.class);
    var source = mock(DamageSource.class);
    when(arrow.getShooter()).thenReturn(player);
    when(source.getDirectEntity()).thenReturn(arrow);
    assertThat(NpcAttackers.attacker(source)).contains(player);
    var tnt = mock(TNTPrimed.class);
    when(tnt.getSource()).thenReturn(player);
    when(source.getDirectEntity()).thenReturn(tnt);
    assertThat(NpcAttackers.attacker(source)).contains(player);
  }

  @Test
  void acceptedEventDamagerIsUsedWhenTheDamageSourceHasNoEntity() {
    var player = mock(Player.class);
    var event = mock(EntityDamageByEntityEvent.class);
    when(event.getDamageSource()).thenReturn(mock(DamageSource.class));
    when(event.getDamager()).thenReturn(player);
    assertThat(NpcAttackers.attacker(event)).contains(player);
    assertThat(NpcAttackers.attacker(mock(DamageSource.class))).isEmpty();
  }
}
