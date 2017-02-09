
var Wormer = (function() {
	"use strict";

	// @const
	var Common = Matter.Common,
		Events = Matter.Events,
		Engine = Matter.Engine,
		Render = Matter.Render,
		World = Matter.World,
		Body = Matter.Body,
		Bodies = Matter.Bodies,
		Constraint = Matter.Constraint,
		Composite = Matter.Composite;

	// @const
	var WORLD_WIDTH = 2000,
		WORLD_HEIGHT = 300;

	var defaults = {
		simulation: {
			wormsPerGeneration: 30,
			preservedWorms: 4,
			timestep: 1000 / 60,
			speedFactor: 0,
			duration: 15000
		},
		worm: {
			width: 10,
			length: 100,
			joints: 4,
			stiffness: 0.4,
			friction: 0.5
		},
		gene: {
			phases: 128,
			period: 5, // timesteps of world passed between each phase
			mutation: 0.01
		},
		render: { // TODO move render out, independent of simulation
			enabled: true,
			width: 1000,
			height: 150,
			scale: 0.5,
			createRenderWrapper: function(i) {
				return $('<div class="render col-lg-6 col-xs-12" id="render-'+i+'"></div>').appendTo("#renders")[0];
			}
		}
	};

	var Simulation = (function() {
		function Simulation(options) {
			var self = this;

			Object.defineProperty(self, 'options', {
				value: deepFreeze(Common.extend(defaults, options)),
				configurable: false,
				enumerable: true,
				writable: false
			});

			self.engines = [];
			self.worms = [];

			self.generation = 0;
			self.phase = 0;
			self.period = 0;

			self.generationTime = 0;
			self.totalEngineTime = 0;

			self._isStarted = false;
			self._isPaused = false;
			self._stepTimeout = 0;

			self._stepWorld = stepWorld;

			for(var i = 0; i < self.options.simulation.wormsPerGeneration; i++) {
				self.engines[i] = setupEngine(createEngine());
				self.worms[i] = new Worm(options).attachTo(self.engines[i]);
			}

			function createEngine() {
				return Engine.create(); // any options?
			}

			function setupEngine(engine) {
				Engine.clear(engine);

				var ground = Body.create({
					parts: [
						Bodies.rectangle(WORLD_WIDTH / 2 - 50, WORLD_HEIGHT + 25, WORLD_WIDTH + 50, 50, {
							friction: 1,
							render: {
								fillStyle: "#555",
								strokeStyle: "#000"
							}
						}),
						Bodies.rectangle(-25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT, {
							render: {
								fillStyle: "#555",
								strokeStyle: "#000"
							}
						}),
					],
					isStatic: true
				});

				World.add(engine.world, ground);

				Events.trigger(self, 'setupEngine', {engine: engine});

				return engine;
			}

			function createRender(i, engine) {
				return Render.create({
					element: self.options.render.createRenderWrapper(i),
					engine: engine,
					bounds: {
						min: { x: 0, y: 0 },
						max: { x: self.options.render.width / self.options.render.scale, y: self.options.render.height / self.options.render.scale }
					},
					options: {
						width: self.options.render.width,
						height: self.options.render.height,
						wireframes: false,
						hasBounds: true
					}
				});
			}

			function wormFitnessCompare(worm1, worm2) {
				return worm2.fitness - worm1.fitness;
			}

			function stepWorld() {
				Events.trigger(self, 'beforeTick');
				for(var i = 0; i < self.options.simulation.wormsPerGeneration; i++) {
					self.worms[i]._tick(self.generationTime, self.phase);
					Engine.update(self.engines[i], self.options.simulation.timestep);
				}

				self.period++;
				if(self.period >= self.options.gene.period) {
					self.period = 0;
					self.phase++;
					if(self.phase >= self.options.gene.phases) {
						self.phase = 0;
					}
				}

				self.generationTime += self.options.simulation.timestep;
				self.totalEngineTime += self.options.simulation.timestep;

				Events.trigger(self, 'afterTick tick', {
					generationTime: self.generationTime,
					totalEngineTime: self.totalEngineTime
				});

				if(self.generationTime < self.options.simulation.duration) {
					self._stepTimeout = setTimeout(stepWorld, self.options.simulation.timestep * self.options.simulation.speedFactor);
				} else {
					proceedGeneration();
					self.period = 0;
					self.phase = 0;
					self.generationTime = 0;
					self.generation++;
					self._stepTimeout = setTimeout(stepWorld, self.options.simulation.timestep * self.options.simulation.speedFactor);
				}
			}

			function proceedGeneration() {
				var averageFitness;
				var totalFitness = 0;
				for(var i = 0; i < self.options.simulation.wormsPerGeneration; i++) {
					self.worms[i].fitness = self.worms[i]._fitness();

					totalFitness += self.worms[i].fitness;

					//setupEngine(self._engines[i]);
					//World.clear(self.engines[i].world, true);
					self.worms[i].detach(true);
				}
				averageFitness = totalFitness / self.options.simulation.wormsPerGeneration;

				self.worms.sort(wormFitnessCompare);

				Events.trigger(self, 'generationEnd', {
					generation: self.generation,
					worms: self.worms,
					averageFitness: averageFitness
				});

				var newWorms = [];

				for(var i = 0; i < self.options.simulation.preservedWorms; i++) {
					newWorms[i] = new Worm(options, self.worms[i].gene).attachTo(self.engines[i]);
				}
				for(var i = self.options.simulation.preservedWorms; i < self.options.simulation.wormsPerGeneration; i++) {
					// Roulette wheel selection
					var selected1 = Math.random() * totalFitness,
						selected2 = Math.random() * totalFitness;
					var worm1 = null,
						worm2 = null;
					for(var j = 0; j < self.worms.length; j++) {
						selected1 -= self.worms[j].fitness;
						selected2 -= self.worms[j].fitness;

						if(selected1 <= 0 && !worm1) {
							worm1 = self.worms[j];
						}
						if(selected2 <= 0 && !worm2) {
							worm2 = self.worms[j];
						}
						if(worm1 && worm2) {
							break;
						}
					}
					var newGene = new Gene(options, worm1.gene, worm2.gene);
					newWorms[i] = new Worm(options, newGene).attachTo(self.engines[i]);
				}

				self.worms = newWorms;
			}
		}

		Simulation.prototype = {
			start: function() {
				if(this._isStarted) {
					if(this._isPaused) {
						this.resume();
					}
					return;
				}

				this.generation = 1;
				this.period = 0;
				this.phase = 0;

				this.generationTime = 0;
				this.totalEngineTime = 0;

				this._isStarted = true;
				this._isPaused = false;

				Events.trigger(this, 'start', {
					options: this.options
				});
				this._stepTimeout = setTimeout(this._stepWorld, 0);
			},
			pause: function() {
				if(!this._isStarted || this._isPaused) return false;

				clearTimeout(this._stepTimeout);
				this._stepTimeout = 0;
				this._isPaused = true;

				Events.trigger(this, 'pause');

				return this._isStarted && this._isPaused; // state can be changed in event handlers
			},
			resume: function() {
				if(!this._isStarted || !this._isPaused) return false;

				this._isPaused = false;
				this._stepTimeout = setTimeout(this._stepWorld, 0);

				Events.trigger(this, 'resume');

				return this._isStarted && !this._isPaused;
			},
			terminate: function() {
				if(!this._isStarted) return false;

				clearTimeout(this._stepTimeout);
				this._stepTimeout = 0;
				this._isStarted = false;
				this._isPaused = false;
				
				Events.trigger(this, 'terminate');

				return !this._isStarted;
			},

			on: function(eventNames, callback) {
				return Events.on(this, eventNames, callback);
			},
			off: function(eventNames, callback) {
				Events.off(this, eventNames, callback);
			}
		};

		function deepFreeze (o) {
			Object.freeze(o);
			if (o === undefined) {
				return o;
			}

			Object.getOwnPropertyNames(o).forEach(function (prop) {
				if (o[prop] !== null
				&& (typeof o[prop] === "object" || typeof o[prop] === "function")
				&& !Object.isFrozen(o[prop])) {
					deepFreeze(o[prop]);
				}
			});

			return o;
		}

		return Simulation;
	})();

	var Gene = (function() {
		/**
		 * 2D Array & 32-bit integer implementation of gene
		 * may switch to String-based, TypedArray-based, ... if the prototypes are implemented correctly.
		 */
		function Gene(options, parent1, parent2) {
			if(parent1 && !parent2) {
				// Copy single gene
				this._gene = [];
				for(var i = 0; i < parent1._gene.length; i++) {
					this._gene[i] = [];
					for(var j = 0; j < parent1._gene[i].length; j++) {
						this._gene[i][j] = parent1._gene[i][j];
					}
				}
			} else if(!parent1) {
				// Create random gene
				var constraintCount = (options.worm.joints - 1) * 2;
				this._gene = [];
				for(var i = 0; i < constraintCount; i++) {
					this._gene[i] = [];
					for(var j = 0; j < options.gene.phases / 32; j++) {
						this._gene[i][j] = Math.random() * (1 << 16) | 0;

						if(options.gene.phases >= j * 32 + 16) {
							this._gene[i][j] |= Math.random() * (1 << 16) << 16;
						}
					}
				}
			} else { // parent1 && parent2
				// Crossover two genes
				this._gene = mutate(options, crossover(options, parent1._gene, parent2._gene));
			}
		}
		Gene.prototype = {
			isSet: function(constraint, phase) {
				var i = phase >> 5; // (phase / 32)|0;
				var j = phase & 31; // phase % 32
				return (this._gene[constraint][i] & (1 << j)) != 0;
			},
			toJSON: function() {
				return JSON.stringify(this._gene);
			}
		};
		Gene.fromJSON = function(json) {
			// toss psudo-gene object as the parent to copy
			// no 'options' argument needed for the copy constructor
			return new Gene(null, { _gene: JSON.parse(json) });
		};

		function crossover(options, gene1, gene2) {
			var gene = [];
			var constraintCount = (options.worm.joints - 1) * 2;
			for(var i = 0; i < constraintCount; i++) {
				var point = (Math.random() * options.gene.phases) | 0;
				var pointLoc = (point / 32) | 0;
				var pointPos = point % 32;
				var pointMask = ((1 << pointPos) - 1) | 0;

				var newChrono = [];

				for(var j = 0; j < pointLoc; j++) {
					newChrono[j] = gene1[i][j];
				}
				newChrono[pointLoc] = (gene1[i][pointLoc] & pointMask) | (gene2[i][pointLoc] & ~pointMask);
				for(var j = pointLoc + 1; j < options.gene.phases / 32; j++) {
					newChrono[j] = gene2[i][j];
				}

				gene[i] = newChrono;
			}
			return gene;
		}

		function mutate(options, gene) {
			for(var i = 0; i < (options.worm.joints - 1) * 2; i++) {
				for(var j = 0; j < /*gene[i].length*/ options.gene.phases / 32; j++) {
					for(var k = 0; k < 32 && j * 32 + k < options.gene.phases; k++) {
						if(Math.random() <= options.gene.mutation) {
							gene[i][j] ^= 1 << k
						}
					}
				}
			}
			return gene;
		}

		return Gene;
	})();

	var Worm = (function() {
		function Worm(options, gene) {
			this.length = options.worm.length;
			this.width = options.worm.width;
			this.joints = options.worm.joints;
			this.stiffness = options.worm.stiffness;
			this.friction = options.worm.friction;
			this.gene = new Gene(options, gene); // even if !gene, the gene is randomly generated

			this.fitness = 0;

			this._engine = null;
			this._composite = null;
		}

		Worm.prototype = {
			attachTo: function(engine) {
				if(this._engine || this._composite) {
					if(this._engine === engine) return;

					throw "Worm is already attached to an engine; call Worm.detach() before attaching to other engine";
				}

				// @const
				var BEGIN_X = 50;

				var divLength = this.length / this.joints;
				var halfWidth = this.width / 2;
				var bodyParts = [];
				var constraints = [];
				for(var i = 0; i < this.joints; i++) {
					var newBody = Bodies.rectangle(BEGIN_X + divLength / 2 + divLength * i, WORLD_HEIGHT - halfWidth, divLength - 1, this.width, {
						friction: this.friction,
						// TODO add density option
						render: {
							fillStyle: (i == this.joints - 2)? "#E77" : "#FAA",
							strokeStyle: "#F88"
						},
						label: "worm-body-" + i
					});
					bodyParts.push(newBody);

					if(i > 0) {
						constraints.push(Constraint.create({
							bodyA: bodyParts[i - 1],
							pointA: { x: divLength / 2 - 1, y: -halfWidth },
							bodyB: newBody,
							pointB: { x: -divLength / 2, y: -halfWidth },
							stiffness: this.stiffness,
							length: 2,
							render: {
								strokeStyle: "#F88"
							},
							label: "worm-joint-" + (i * 2)
						}));
						constraints.push(Constraint.create({
							bodyA: bodyParts[i - 1],
							pointA: { x: divLength / 2 - 1, y: halfWidth },
							bodyB: newBody,
							pointB: { x: -divLength / 2, y: halfWidth },
							stiffness: this.stiffness,
							length: 2,
							render: {
								strokeStyle: "#F88"
							},
							label: "worm-joint-" + (i * 2 + 1)
						}));
					}
				}

				var composite = Composite.create({
					bodies: bodyParts,
					constraints: constraints,
					label: "worm"
				});

				World.add(engine.world, composite);

				this._engine = engine;
				this._composite = composite;

				return this;
			},
			detach: function(removeBody) {
				if(removeBody) Composite.remove(this._engine.world, this._composite);
				this._engine = null;
				this._composite = null;
			},

			/**
			 * Called once per timestep, before world update.
			 * Worms should do movement, fitness calculation(in case the final 'fitness' call is not sufficient), or
			 * any other tasks on this function.
			 */
			_tick: function(phase) {
				var constraints = this._composite.constraints;
				for(var i = 0; i < constraints.length; i++) {
					constraints[i].length = this.gene.isSet(i, phase)? 6 : 2;
				}
			},
			/* This function should return same fitness value at any time before a call to Worm.tick(). */
			_fitness: function() {
				var minX = Infinity;
				var body = this._composite.bodies;
				for(var i = 0; i < body.length; i++) {
					minX = Math.min(minX, body[i].position.x);
				}
				return minX;
			}
		};

		return Worm;
	})();

	return {
		Simulation: Simulation,
		Gene: Gene,
		Worm: Worm
	};
})();
