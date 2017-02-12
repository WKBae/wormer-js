
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
	var WORLD_WIDTH = 4000,
		WORLD_HEIGHT = 300;

	var Simulation = (function() {
		function Simulation(options) {
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
				}
			};

			/*Object.defineProperty(this, 'options', {
				value: deepFreeze(Common.extend(defaults, options)),
				configurable: false,
				enumerable: true,
				writable: false
			});*/
			this.options = deepFreeze(Common.extend(defaults, options));

			this.engines = [];
			this.worms = [];

			this.generation = 0;
			this.phase = 0;
			this.period = 0;

			this.generationTime = 0;
			this.totalEngineTime = 0;

			this.isStarted = false;
			this.isPaused = false;
			this._stepTimeout = 0;

			this._stepWorld = stepWorld;

			var that = this;

			for(var i = 0; i < this.options.simulation.wormsPerGeneration; i++) {
				this.engines[i] = setupEngine(createEngine());
				this.worms[i] = new Worm(options).attachTo(this.engines[i]);
			}

			function createEngine() {
				return Engine.create({
					//constraintIterations: 3 // may have some side-effects on old simulation results
				});
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

				Events.trigger(that, 'setupEngine', {engine: engine});

				return engine;
			}

			// cached option values for performance
			var timestep = this.options.simulation.timestep;
			var wormLength = this.options.simulation.wormsPerGeneration;
			var preservedLength = this.options.simulation.preservedWorms;
			var maxPeriod = this.options.gene.period;
			var maxPhase = this.options.gene.phases;
			var finishTime = this.options.simulation.duration;
			var speedFactor = this.options.simulation.speedFactor; // TODO move speedFactor out of option to make it configurable
			function stepWorld() {
				Events.trigger(that, 'beforeTick');
				for(var i = 0; i < wormLength; i++) {
					that.worms[i]._tick(that.generationTime, that.phase);
					Engine.update(that.engines[i], timestep);
				}

				that.period++;
				if(that.period >= maxPeriod) {
					that.period = 0;
					that.phase++;
					if(that.phase >= maxPhase) {
						that.phase = 0;
					}
				}

				that.generationTime += timestep;
				that.totalEngineTime += timestep;

				Events.trigger(that, 'afterTick tick');

				if(that.generationTime < finishTime) {
					if(that.isStarted && !that.isPaused) { // Simulation can be paused or terminated in a event handler
						that._stepTimeout = setTimeout(stepWorld, timestep * speedFactor);
					} else {
						that._stepTimeout = 0;
					}
				} else {
					proceedGeneration();
					that.period = 0;
					that.phase = 0;
					that.generationTime = 0;
					that.generation++;
					if(that.isStarted && !that.isPaused) {
						that._stepTimeout = setTimeout(stepWorld, timestep * speedFactor);
					} else {
						that._stepTimeout = 0;
					}
				}
			}

			function proceedGeneration() {
				var averageFitness;
				var totalFitness = 0;
				for(var i = 0; i < wormLength; i++) {
					that.worms[i].fitness = that.worms[i]._fitness();

					totalFitness += that.worms[i].fitness;

					//setupEngine(that._engines[i]);
					//World.clear(that.engines[i].world, true);
					that.worms[i].detach(true);
				}
				averageFitness = totalFitness / wormLength;

				that.worms.sort(wormFitnessCompare);

				Events.trigger(that, 'generationEnd', { // TODO event object not needed? these data are now open in Simulation obj
					generation: that.generation,
					worms: that.worms,
					averageFitness: averageFitness
				});

				var newWorms = [];

				for(var i = 0; i < preservedLength; i++) {
					newWorms[i] = new Worm(options, that.worms[i].gene).attachTo(that.engines[i]);
				}
				for(var i = preservedLength; i < wormLength; i++) {
					// Roulette wheel selection
					var selected1 = Math.random() * totalFitness,
						selected2 = Math.random() * totalFitness;
					var worm1 = null,
						worm2 = null;
					for(var j = 0; j < that.worms.length; j++) {
						selected1 -= that.worms[j].fitness;
						selected2 -= that.worms[j].fitness;

						if(selected1 <= 0 && !worm1) {
							worm1 = that.worms[j];
						}
						if(selected2 <= 0 && !worm2) {
							worm2 = that.worms[j];
						}
						if(worm1 && worm2) {
							break;
						}
					}
					var newGene = new Gene(options, worm1.gene, worm2.gene);
					newWorms[i] = new Worm(options, newGene).attachTo(that.engines[i]);
				}

				that.worms = newWorms;

				Events.trigger(that, 'generationStart');
			}

			function wormFitnessCompare(worm1, worm2) {
				return worm2.fitness - worm1.fitness;
			}
		}

		Simulation.prototype = {
			start: function() {
				if(this.isStarted) {
					if(this.isPaused) {
						this.resume();
					}
					return;
				}

				this.generation = 1;
				this.period = 0;
				this.phase = 0;

				this.generationTime = 0;
				this.totalEngineTime = 0;

				this.isStarted = true;
				this.isPaused = false;

				Events.trigger(this, 'start', {
					options: this.options
				});
				Events.trigger(this, 'generationStart');
				this._stepTimeout = setTimeout(this._stepWorld, 0);
			},
			pause: function() {
				if(!this.isStarted || this.isPaused) return false;

				clearTimeout(this._stepTimeout);
				this._stepTimeout = 0;
				this.isPaused = true;

				Events.trigger(this, 'pause');

				return this.isStarted && this.isPaused; // state can be changed in event handlers
			},
			resume: function() {
				if(!this.isStarted || !this.isPaused) return false;

				this.isPaused = false;
				this._stepTimeout = setTimeout(this._stepWorld, 0);

				Events.trigger(this, 'resume');

				return this.isStarted && !this.isPaused;
			},
			terminate: function() {
				if(!this.isStarted) return false;

				clearTimeout(this._stepTimeout);
				this._stepTimeout = 0;
				this.isStarted = false;
				this.isPaused = false;
				
				Events.trigger(this, 'terminate');

				return !this.isStarted;
			},

			on: function(eventNames, callback) {
				Events.on(this, eventNames, callback);
				return this;
			},
			off: function(eventNames, callback) {
				Events.off(this, eventNames, callback);
				return this;
			},

			toJSON: function() {
				var clone = {};
				var blacklist = ['engines', 'isStarted', 'isPaused', '_stepTimeout', '_stepWorld', 'events'];
				for(var key in this) {
					if(this.hasOwnProperty(key) && blacklist.indexOf(key) === -1) {
						clone[key] = this[key];
					}
				}
				return JSON.stringify(clone);
			}
		};
		Simulation.fromJSON = function(json) {
			if(typeof json === 'string') {
				json = JSON.parse(json);
			}
			var sim = new Simulation(json.options);

			for(var i = 0; i < json.worms.length; i++) {
				sim.worms[i] = Worm.fromJSON(json.worms[i]).attachTo(sim.engines[i]);
			}

			var props = ['generation', 'phase', 'period', 'generationTime', 'totalEngineTime'];
			for(var i = 0; i < props.length; i++) {
				sim[props[i]] = json[props[i]];
			}

			sim.isStarted = true;
			sim.isPaused = true;
			return sim;
		}

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
			if(typeof json === 'string') {
				json = JSON.parse(json);
			}

			// toss psudo-gene object as the parent to copy
			// no 'options' argument needed for the copy constructor
			return new Gene(null, { _gene: json });
		};

		function crossover(options, gene1, gene2) {
			var gene = [];
			var constraintCount = (options.worm.joints - 1) * 2;
			var phases = options.gene.phases;
			for(var i = 0; i < constraintCount; i++) {
				var point = (Math.random() * phases) | 0;
				var pointLoc = (point / 32) | 0;
				var pointPos = point % 32;
				var pointMask = ((1 << pointPos) - 1) | 0;

				var newChrono = [];

				for(var j = 0; j < pointLoc; j++) {
					newChrono[j] = gene1[i][j];
				}
				newChrono[pointLoc] = (gene1[i][pointLoc] & pointMask) | (gene2[i][pointLoc] & ~pointMask);
				for(var j = pointLoc + 1; j < phases / 32; j++) {
					newChrono[j] = gene2[i][j];
				}

				gene[i] = newChrono;
			}
			return gene;
		}

		function mutate(options, gene) {
			var constraintCount = (options.worm.joints - 1) * 2;
			var phases = options.gene.phases;
			var mutation = options.gene.mutation
			for(var i = 0; i < constraintCount; i++) {
				for(var j = 0; j < /*gene[i].length*/ phases / 32; j++) {
					for(var k = 0; k < 32 && j * 32 + k < phases; k++) {
						if(Math.random() <= mutation) {
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
				return this;
			},

			toJSON: function() {
				var clone = {};
				var blacklist = ['_engine', '_composite', 'events'];
				for(var key in this) {
					if(this.hasOwnProperty(key) && blacklist.indexOf(key) === -1) {
						clone[key] = this[key];
					}
				}
				return JSON.stringify(clone);
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

		Worm.fromJSON = function(json) {
			if(typeof json === 'string') {
				json = JSON.parse(json);
			}

			var worm = new Worm({
				worm: json
			}, Gene.fromJSON(json.gene));
			return worm;
		}

		return Worm;
	})();


	return {
		Simulation: Simulation,
		Gene: Gene,
		Worm: Worm
	};
})();
