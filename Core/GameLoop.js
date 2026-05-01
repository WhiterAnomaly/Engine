/**
 * NERVE ENGINE
 * core/GameLoop.js
 *
 * Responsável pelo tick principal da engine.
 * Gerencia delta time, fps, estados (running/paused/stopped)
 * e expõe hooks para sistemas externos se registrarem.
 *
 * NÃO conhece nenhum jogo específico.
 * É o motor. O jogo decide o que rodar dentro dele.
 *
 * @author Claude (Nerve Engine Team)
 * @version 0.1.0
 */

export class GameLoop {
  /**
   * @param {Object} options
   * @param {number}  [options.targetFPS=60]   - FPS alvo
   * @param {boolean} [options.fixedStep=false] - Usar timestep fixo (útil para física)
   * @param {number}  [options.maxDelta=100]    - Delta máximo em ms (evita spiral of death)
   */
  constructor({ targetFPS = 60, fixedStep = false, maxDelta = 100 } = {}) {
    this._targetFPS    = targetFPS;
    this._fixedStep    = fixedStep;
    this._maxDelta     = maxDelta;

    this._state        = 'stopped'; // 'running' | 'paused' | 'stopped'
    this._rafId        = null;

    this._lastTime     = 0;
    this._accumulator  = 0;
    this._fixedDelta   = 1000 / targetFPS;

    // Métricas públicas (leitura)
    this.metrics = {
      fps:        0,
      frameCount: 0,
      totalTime:  0,   // ms desde o start()
      delta:      0,   // delta do último frame (ms)
    };

    // Sistemas registrados — executados em ordem de prioridade
    // { id, priority, update: fn(delta, metrics), enabled }
    this._systems = [];

    // Callbacks de ciclo de vida
    this._onStart  = [];
    this._onPause  = [];
    this._onResume = [];
    this._onStop   = [];

    this._tick = this._tick.bind(this);
  }

  // ─────────────────────────────────────────────
  // CONTROLE DE ESTADO
  // ─────────────────────────────────────────────

  /** Inicia o loop. */
  start() {
    if (this._state === 'running') return this;

    this._state    = 'running';
    this._lastTime = performance.now();
    this._accumulator = 0;

    this._emit(this._onStart);
    this._rafId = requestAnimationFrame(this._tick);
    return this;
  }

  /** Pausa o loop sem destruí-lo. */
  pause() {
    if (this._state !== 'running') return this;
    this._state = 'paused';
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._emit(this._onPause);
    return this;
  }

  /** Retoma após pausa. */
  resume() {
    if (this._state !== 'paused') return this;
    this._state    = 'running';
    this._lastTime = performance.now(); // reset para evitar spike de delta
    this._emit(this._onResume);
    this._rafId = requestAnimationFrame(this._tick);
    return this;
  }

  /** Para o loop completamente. */
  stop() {
    if (this._state === 'stopped') return this;
    cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this._state = 'stopped';
    this._emit(this._onStop);
    return this;
  }

  /** Estado atual: 'running' | 'paused' | 'stopped' */
  get state() {
    return this._state;
  }

  // ─────────────────────────────────────────────
  // REGISTRO DE SISTEMAS
  // ─────────────────────────────────────────────

  /**
   * Registra um sistema para ser chamado a cada frame.
   *
   * @param {string}   id         - Identificador único
   * @param {Function} updateFn   - fn(delta: number, metrics: object) => void
   * @param {number}   [priority=0] - Menor = executa primeiro
   * @returns {GameLoop} this (fluent API)
   *
   * @example
   * loop.register('renderer', (delta) => renderer.draw(delta), 10)
   */
  register(id, updateFn, priority = 0) {
    if (this._systems.find(s => s.id === id)) {
      console.warn(`[GameLoop] Sistema '${id}' já registrado. Ignorando.`);
      return this;
    }

    this._systems.push({ id, priority, update: updateFn, enabled: true });
    this._systems.sort((a, b) => a.priority - b.priority);
    return this;
  }

  /**
   * Remove um sistema registrado.
   * @param {string} id
   */
  unregister(id) {
    this._systems = this._systems.filter(s => s.id !== id);
    return this;
  }

  /**
   * Ativa ou desativa um sistema sem removê-lo.
   * @param {string}  id
   * @param {boolean} enabled
   */
  setEnabled(id, enabled) {
    const sys = this._systems.find(s => s.id === id);
    if (sys) sys.enabled = enabled;
    return this;
  }

  // ─────────────────────────────────────────────
  // HOOKS DE CICLO DE VIDA
  // ─────────────────────────────────────────────

  onStart(fn)  { this._onStart.push(fn);  return this; }
  onPause(fn)  { this._onPause.push(fn);  return this; }
  onResume(fn) { this._onResume.push(fn); return this; }
  onStop(fn)   { this._onStop.push(fn);   return this; }

  // ─────────────────────────────────────────────
  // TICK INTERNO
  // ─────────────────────────────────────────────

  _tick(timestamp) {
    if (this._state !== 'running') return;

    let rawDelta = timestamp - this._lastTime;
    this._lastTime = timestamp;

    // Clamp: evita delta gigante após tab ficar em background
    if (rawDelta > this._maxDelta) rawDelta = this._maxDelta;

    this.metrics.delta      = rawDelta;
    this.metrics.totalTime += rawDelta;
    this.metrics.frameCount++;
    this.metrics.fps        = Math.round(1000 / rawDelta);

    if (this._fixedStep) {
      // Fixed timestep com accumulator
      this._accumulator += rawDelta;
      while (this._accumulator >= this._fixedDelta) {
        this._runSystems(this._fixedDelta);
        this._accumulator -= this._fixedDelta;
      }
    } else {
      // Variable timestep (padrão para VN)
      this._runSystems(rawDelta);
    }

    this._rafId = requestAnimationFrame(this._tick);
  }

  _runSystems(delta) {
    for (const sys of this._systems) {
      if (!sys.enabled) continue;
      try {
        sys.update(delta, this.metrics);
      } catch (err) {
        console.error(`[GameLoop] Erro no sistema '${sys.id}':`, err);
      }
    }
  }

  _emit(callbacks) {
    for (const fn of callbacks) {
      try { fn(this.metrics); } catch (err) {
        console.error('[GameLoop] Erro em callback de ciclo de vida:', err);
      }
    }
  }
}
