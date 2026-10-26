import { World } from "./engine/world.js";
import { Champion } from "./engine/unit.js";
import { skillshotFromSpell } from "./engine/skillshot.js";
import { makePlayer, resolveAttack, applyInput, castAbility, tickAbilities, tuneEnemy, ARENA, ringPositions } from "./drills/common.js";
import { config } from "./config.js";
import { clamp, norm, makeRng } from "./core/math.js";

/** Power-up types matching PowerUps.txt */
export const POWERUP_TYPES = [
  {
    id: 'heal',
    name: 'Cura',
    icon: '❤️+',
    color: '#ff4d6a',
    duration: 0, // instant
    apply: (player) => {
      const heal = Math.max(1, Math.floor(player.maxHp * 0.25));
      player.hp = Math.min(player.maxHp, player.hp + heal);
      return `Cura +${heal}`;
    }
  },
  {
    id: 'atk-speed',
    name: 'Atk Speed Boost',
    icon: '🏹↑',
    color: '#ffb84d',
    duration: 5,
    apply: (player) => {
      player.buffAttackSpeed = 1.2;
      player.buffAttackSpeedTimer = 5;
      return 'Vel. Ataque +20% (5s)';
    }
  },
  {
    id: 'mov-speed',
    name: 'Mov Speed Boost',
    icon: '👟↑',
    color: '#4dff88',
    duration: 5,
    apply: (player) => {
      player.buffMoveSpeed = 1.3;
      player.buffMoveSpeedTimer = 5;
      return 'Vel. Mov. +30% (5s)';
    }
  },
  {
    id: 'vamp',
    name: 'Vampirismo',
    icon: '⚔️🩸',
    color: '#d84dff',
    duration: 8,
    apply: (player) => {
      player.buffVamp = 0.2;
      player.buffVampTimer = 8;
      return 'Vampirismo 20% (8s)';
    }
  },
  {
    id: 'atk-speed-nerf',
    name: 'Atk Speed Nerf (Inimigo)',
    icon: '🏹↓',
    color: '#ff4d4d',
    duration: 5,
    isDebuff: true,
    apply: (player, enemy) => {
      enemy.debuffAttackSpeed = 0.8;
      enemy.debuffAttackSpeedTimer = 5;
      return 'Vel. Ataque inimigo -20% (5s)';
    }
  },
  {
    id: 'mov-speed-nerf',
    name: 'Mov Speed Nerf (Inimigo)',
    icon: '👟↓',
    color: '#4d4dff',
    duration: 5,
    isDebuff: true,
    apply: (player, enemy) => {
      enemy.debuffMoveSpeed = 0.7;
      enemy.debuffMoveSpeedTimer = 5;
      return 'Vel. Mov. inimigo -30% (5s)';
    }
  }
];

const ABILITY_COOLDOWNS = { Q: 4, W: 6, E: 8, R: 12 };

export class ArenaMode {
  constructor({ champion1, champion2, isBot = false, botDifficulty = 'normal', powerupsEnabled = true, abilitiesEnabled = true, rng, onMoveMarker }) {
    this.world = new World(ARENA);
    this.rng = rng;
    this.isBot = isBot;
    this.botDifficulty = botDifficulty;
    this.powerupsEnabled = powerupsEnabled;
    this.abilitiesEnabled = abilitiesEnabled;
    this.onMoveMarker = onMoveMarker;
    
    // Players
    this.player1 = makePlayer(champion1, ARENA.w * 0.25, ARENA.h * 0.5, 1);
    this.player1.team = 'p1';
    this.player1.isPlayer = true;
    this.player1.id = this.player1.id || 'p1';
    this.world.add(this.player1);
    
    this.player2 = makePlayer(champion2, ARENA.w * 0.75, ARENA.h * 0.5, 1);
    this.player2.team = 'p2';
    this.player2.id = this.player2.id || 'p2';
    if (isBot) {
      this.player2.isBot = true;
      this.player2.botDifficulty = botDifficulty;
      this.player2.botTimer = 0;
    } else {
      this.player2.isPlayer = true;
    }
    this.world.add(this.player2);
    
    // State
    this.timeLeft = 180; // 3 minutes
    this.finished = false;
    this.outcome = 'ongoing';
    this.p1Score = 0;
    this.p2Score = 0;
    this.maxScore = 5; // first to 5 kills
    
    // Powerups
    this.powerups = [];
    this.powerupSpawnTimer = 5; // spawn first powerup quickly
    this.maxPowerups = 3;
    this.spawnPowerup();
    this.spawnPowerup();
    
    // Active powerup effects for HUD
    this.activePowerups = new Map(); // playerId -> [{ type, timer, maxTimer, icon, color, name }]
    
    // Buffs/debuffs
    this.world.onDamage = (unit, amount, source) => {
      if (!unit) return;
      if (source && source.team && unit.team && source.team !== unit.team) {
        if (unit.team === 'p1') {
          this.player1.lastDamageFrom = source;
        } else if (unit.team === 'p2') {
          this.player2.lastDamageFrom = source;
        }
      }
      // Vampirism
      if (source && source.buffVamp > 0 && source.alive) {
        const heal = amount * source.buffVamp;
        source.hp = Math.min(source.maxHp, source.hp + heal);
      }
    };
    
    // Kill tracking
    this.world.onDeath = (unit, killer) => {
      if (!unit) return;
      if (unit.team === 'p1') {
        this.p2Score++;
        this.checkWin();
        // Killer heals 50% of max HP
        if (killer && typeof killer === 'object' && killer.alive) {
          killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.5);
        }
        if (this.player1) this.scheduleRespawn(this.player1, killer);
      } else if (unit.team === 'p2') {
        this.p1Score++;
        this.checkWin();
        // Killer heals 50% of max HP
        if (killer && typeof killer === 'object' && killer.alive) {
          killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.5);
        }
        if (this.player2) this.scheduleRespawn(this.player2, killer);
      }
    };
  }
  
  checkWin() {
    if (this.p1Score >= this.maxScore) {
      this.finished = true;
      this.outcome = 'p1';
    } else if (this.p2Score >= this.maxScore) {
      this.finished = true;
      this.outcome = 'p2';
    }
  }
  
  scheduleRespawn(player, killer) {
    if (!player) return;
    player.respawnAt = this.world.time + 4;
    player.respawnPos = { x: player.team === 'p1' ? ARENA.w * 0.25 : ARENA.w * 0.75, y: ARENA.h * 0.5 };
    player.invulnerableUntil = this.world.time + 9; // 4s respawn + 5s invulnerability
    if (killer && typeof killer === 'object' && killer.killStreak !== undefined) {
      killer.killStreak = (killer.killStreak || 0) + 1;
    }
  }
  
  update(dt, input1, input2) {
    if (this.finished) return;
    
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      this.finished = true;
      this.outcome = this.p1Score > this.p2Score ? 'p1' : (this.p2Score > this.p1Score ? 'p2' : 'draw');
      return;
    }
    
    // Update buffs/debuffs
    try { this.updateBuffs(dt); } catch {}
    
    // Update active powerup timers
    try { this.updatePowerupTimers(dt); } catch {}
    
    // Player 1 input (always human)
    if (this.player1 && this.player1.alive) {
      try {
        const p1Input = input1;
        p1Input.dt = dt;
        const p1Orders = applyInput(this.player1, p1Input, this.world, this.onMoveMarker);
        if (this.abilitiesEnabled) {
          for (const slot of ['Q', 'W', 'E', 'R']) {
            if (p1Input.hit && p1Input.hit(`Key${slot}`) && p1Input.mouse) {
              castAbility(this.player1, slot, p1Input.mouse.x, p1Input.mouse.y, this.world);
            }
          }
        }
        tickAbilities(this.player1, dt);
        if (this.player1.controller) this.player1.controller.update(dt, this.world);
        const p1Resolved = this.player1.tickTimers(dt);
        if (p1Resolved) resolveAttack(this.player1, this.world, p1Resolved, null);
      } catch (e) {
        console.error('p1 update error', e, e.stack);
      }
    } else if (this.player1 && this.player1.controller) {
      try {
        this.player1.controller.stop();
        tickAbilities(this.player1, dt);
      } catch {}
    }
    
    // Player 2 input - for PvP, input is handled externally via applyP2Input
    if (this.player2 && this.player2.alive) {
      try {
        if (this.isBot) {
          this.updateBot(this.player2, dt);
        } else if (input2) {
          // Input2 is handled externally for PvP, just tick abilities and timers
          tickAbilities(this.player2, dt);
          if (this.player2.controller) this.player2.controller.update(dt, this.world);
        }
        const p2Resolved = this.player2.tickTimers(dt);
        if (p2Resolved) resolveAttack(this.player2, this.world, p2Resolved, null);
      } catch (e) {
        console.error('p2 update error', e, e.stack);
      }
    } else if (this.player2 && this.player2.controller) {
      try {
        this.player2.controller.stop();
        tickAbilities(this.player2, dt);
      } catch {}
    }
    
    // Powerups
    if (this.powerupsEnabled) {
      try { this.updatePowerups(dt); } catch {}
    }
    
    // Respawns
    for (const p of [this.player1, this.player2]) {
      if (p && !p.alive && p.respawnAt && this.world.time >= p.respawnAt) {
        try { this.respawnPlayer(p); } catch {}
      }
    }
    
    try {
      this.world.update(dt);
      this.world.separate();
      this.world.clampUnits();
    } catch (e) {
      console.error('world update error', e, e.stack);
    }
  }
  
  updateBuffs(dt) {
    for (const player of [this.player1, this.player2]) {
      if (!player) continue;
      if (player.buffAttackSpeedTimer > 0) {
        player.buffAttackSpeedTimer -= dt;
        if (player.buffAttackSpeedTimer <= 0) player.buffAttackSpeed = 1;
      }
      if (player.buffMoveSpeedTimer > 0) {
        player.buffMoveSpeedTimer -= dt;
        if (player.buffMoveSpeedTimer <= 0) player.buffMoveSpeed = 1;
      }
      if (player.buffVampTimer > 0) {
        player.buffVampTimer -= dt;
        if (player.buffVampTimer <= 0) player.buffVamp = 0;
      }
      if (player.debuffAttackSpeedTimer > 0) {
        player.debuffAttackSpeedTimer -= dt;
        if (player.debuffAttackSpeedTimer <= 0) player.debuffAttackSpeed = 1;
      }
      if (player.debuffMoveSpeedTimer > 0) {
        player.debuffMoveSpeedTimer -= dt;
        if (player.debuffMoveSpeedTimer <= 0) player.debuffMoveSpeed = 1;
      }
    }
  }
  
  updatePowerupTimers(dt) {
    for (const [playerId, effects] of this.activePowerups) {
      const player = playerId === 'p1' ? this.player1 : this.player2;
      if (!player) {
        this.activePowerups.delete(playerId);
        continue;
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        const effect = effects[i];
        effect.timer -= dt;
        if (effect.timer <= 0) {
          // Remove effect
          if (effect.type === 'atk-speed') player.buffAttackSpeed = 1;
          else if (effect.type === 'mov-speed') player.buffMoveSpeed = 1;
          else if (effect.type === 'vamp') player.buffVamp = 0;
          else if (effect.type === 'atk-speed-nerf') player.debuffAttackSpeed = 1;
          else if (effect.type === 'mov-speed-nerf') player.debuffMoveSpeed = 1;
          effects.splice(i, 1);
        }
      }
      if (effects.length === 0) {
        this.activePowerups.delete(playerId);
      }
    }
  }
  
  getActivePowerups(playerId) {
    return this.activePowerups.get(playerId) || [];
  }
  
  updatePowerups(dt) {
    this.powerupSpawnTimer -= dt;
    
    // Spawn powerups
    if (this.powerupSpawnTimer <= 0 && this.powerups.length < this.maxPowerups) {
      try { this.spawnPowerup(); } catch {}
      this.powerupSpawnTimer = this.rng.range(12, 20);
    }
    
    // Check collection and despawn
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const pu = this.powerups[i];
      if (!pu) { this.powerups.splice(i, 1); continue; }
      // Despawn after life expires
      pu.life = (pu.life ?? 30) - dt;
      if (pu.life <= 0) {
        this.powerups.splice(i, 1);
        continue;
      }
      for (const player of [this.player1, this.player2]) {
        if (!player || !player.alive) continue;
        const d = Math.hypot((player.x || 0) - (pu.x || 0), (player.y || 0) - (pu.y || 0));
        if (d <= (player.hitRadius || 45) + 30) {
          try { this.collectPowerup(player, pu); } catch {}
          this.powerups.splice(i, 1);
          break;
        }
      }
    }
  }
  
  spawnPowerup() {
    const type = this.rng.pick(POWERUP_TYPES);
    const margin = 200;
    const pu = {
      ...type,
      x: this.rng.range(margin, ARENA.w - margin),
      y: this.rng.range(margin, ARENA.h - margin),
      life: 30, // despawn after 30s
      collected: false
    };
    this.powerups.push(pu);
  }
  
  collectPowerup(player, pu) {
    if (!player || !player.alive || !pu) return;
    try {
      const enemy = player.team === 'p1' ? this.player2 : this.player1;
      const msg = pu.apply ? pu.apply(player, enemy && enemy.alive ? enemy : null) : '';
      if (this.onMoveMarker && pu.x !== undefined && pu.y !== undefined) {
        this.onMoveMarker(pu.x, pu.y, pu.color);
      }
      
      // Track for HUD
      const playerId = player.team;
      if (!this.activePowerups.has(playerId)) {
        this.activePowerups.set(playerId, []);
      }
      
      if (pu.duration > 0) {
        this.activePowerups.get(playerId).push({
          type: pu.id,
          timer: pu.duration,
          maxTimer: pu.duration,
          icon: pu.icon,
          color: pu.color,
          name: pu.name
        });
      }
      
      if (this.showBanner) this.showBanner(msg, 'good');
    } catch (e) {
      console.error('collectPowerup error', e);
    }
  }
  
  updateBot(bot, dt) {
    if (!bot || !bot.alive || !this.player1 || !this.player1.alive) return;
    bot.botTimer -= dt;
    const target = this.player1;
    const d = Math.hypot(target.x - bot.x, target.y - bot.y);
    
    const difficultySettings = {
      easy: { reaction: 0.5, accuracy: 0.6, aggression: 0.4 },
      normal: { reaction: 0.3, accuracy: 0.8, aggression: 0.6 },
      hard: { reaction: 0.15, accuracy: 0.95, aggression: 0.8 },
      expert: { reaction: 0.05, accuracy: 1.0, aggression: 1.0 }
    };
    const settings = difficultySettings[this.botDifficulty] || difficultySettings.normal;
    
    // Decide action
    if (bot.botTimer <= 0) {
      bot.botTimer = settings.reaction + this.rng.range(-0.1, 0.2);
      
      if (d <= bot.attackRange * 1.1 && bot.canAttack()) {
        // Attack
        bot.controller.attackUnit(target);
      } else if (d > bot.attackRange * 1.2) {
        // Move closer
        const movePoint = {
          x: target.x + this.rng.range(-100, 100),
          y: target.y + this.rng.range(-100, 100)
        };
        bot.controller.moveTo(movePoint.x, movePoint.y);
      } else {
        // In range but can't attack yet - strafe
        const angle = Math.atan2(bot.y - target.y, bot.x - target.x) + this.rng.range(-0.5, 0.5);
        const strafePoint = {
          x: bot.x + Math.cos(angle) * 200,
          y: bot.y + Math.sin(angle) * 200
        };
        bot.controller.moveTo(strafePoint.x, strafePoint.y);
      }
      
      // Use abilities
      if (this.abilitiesEnabled && this.rng.chance(settings.accuracy * 0.3)) {
        const available = ['Q', 'W', 'E', 'R'].filter(s => bot.abilityCooldowns[s] <= 0);
        if (available.length) {
          const spell = this.rng.pick(available);
          castAbility(bot, spell, target.x, target.y, this.world);
        }
      }
    }
    
    tickAbilities(bot, dt);
    bot.controller.update(dt, this.world);
  }
  
  respawnPlayer(player) {
    player.hp = player.maxHp;
    player.alive = true;
    player.deadChecked = false;
    player.x = player.respawnPos.x;
    player.y = player.respawnPos.y;
    player.attackTimer = 0;
    player.casting = 0;
    player.pendingTarget = null;
    player.respawnAt = null;
    player.killStreak = 0;
    if (player.controller) {
      player.controller.order = { kind: 'stop' };
    }
    // Clear debuffs
    player.debuffAttackSpeed = 1;
    player.debuffAttackSpeedTimer = 0;
    player.debuffMoveSpeed = 1;
    player.debuffMoveSpeedTimer = 0;
  }
  
  render(scene, opts = {}) {
    if (!scene || !this.world) return;
    try {
      scene.render(this.world, {
        player: this.player1, // primary view follows p1
        showRanges: opts.showRanges !== false,
        attackMoveActive: opts.attackMoveActive,
        focusTarget: opts.focusTarget,
        punishTarget: opts.punishTarget,
        dt: opts.dt,
        // Custom: render powerups
        powerups: this.powerups
      });
    } catch (e) {
      console.error('arena render error', e, e.stack);
    }
  }
  
  // Get abilities for HUD
  getAbilities(player) {
    if (!player.data?.spells) return [];
    return player.data.spells
      .filter(s => s.slot !== 'P')
      .map(s => ({
        slot: s.slot,
        name: s.name,
        icon: this.getSpellIcon(s),
        cooldown: player.abilityCooldowns[s.slot] || 0,
        maxCooldown: ABILITY_COOLDOWNS[s.slot] || 6
      }));
  }
  
  getSpellIcon(spell) {
    const icons = {
      'linear': '➤',
      'circle': '⬤',
      'cone': '▲',
      'self': '◆'
    };
    return icons[spell.shape] || '★';
  }
  
  result() {
    return {
      winner: this.outcome,
      p1Score: this.p1Score,
      p2Score: this.p2Score,
      duration: 180 - this.timeLeft,
      p1Champion: this.player1.data?.name || "—",
      p2Champion: this.player2.data?.name || "—"
    };
  }
}

/** 
 * Input for P2 is handled externally via Socket.io in online mode.
 * No local multiplayer (WASD) is supported - only online via Socket.io.
 */
