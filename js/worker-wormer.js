
var WorkerWormer = (function() {
	"use strict";

	var Events = Matter.Events,
		Common = Matter.Common;

	var Simulation, Worm, Gene;

	Simulation = (function() {
		function Simulation(options) {
			var defaults = {
				simulation: {
					wormsPerGeneration: 30,
					preservedWorms: 4,
					timestep: 1000 / 60,
					speedFactor: 0,
					duration: 15000,
					iterations: {
						constraint: 2,
						position: 6,
						velocity: 4
					}
				},
				worm: {
					width: 10,
					length: 100,
					density: 0.001,
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

			this.worms = [];

			this.generation = 0;

			this.generationTime = 0;
			this._accumEngineTime = 0;
			this.totalEngineTime = 0;

			this.isStarted = false;
			this.isPaused = false;

			this._worker = new Worker('js/wormer-nested-worker.js');
			this._worker.onmessage = onWorkerMessage;

			this._distributeGenes = distributeGenes;

			var that = this;

			var count = this.options.simulation.wormsPerGeneration;
			for(var i = 0; i < count; i++) {
				this.worms[i] = new Worm(options);
			}

			this._worker.postMessage({
				'type': "setup",
				'count': count,
				'options': this.options
			});


			var duration = this.options.simulation.duration;
			var genEnded = false;
			function onWorkerMessage(e) {
				var data = e.data;console.log(data);
				switch(data.type) {
				case 'setupDone':
					distributeGenes();
					Events.trigger(that, 'ready');
					break;
				case 'progress':
					that.generationTime = duration * data.progress;
					that.totalEngineTime = that._accumEngineTime + that.generationTime;
					Events.trigger(that, 'tick');
					break;
				case 'generationEnd':
					proceedGeneration(data.genes, data.fitness, data.average);
					distributeGenes();
					that._accumEngineTime += duration;
					that.generationTime = 0;
					that.generation++;
					/*if(that.isStarted && !that.isPaused) {
						that._worker.postMessage({ 'type': "start" });
					}*/
					that.isPaused = true;
					that.resume();
					break;
				case "started":
					that.isStarted = true;
					that.isPaused = false;

					Events.trigger(that, 'start', {
						options: that.options
					});
					Events.trigger(that, 'generationStart');
					break;
				case "paused":
					that.isPaused = true;
					Events.trigger(that, 'pause');
					break;
				case "resumed":
					that.isPaused = false;
					Events.trigger(that, 'resume');
					break;
				case "terminated":
					that.isStarted = false;
					that.isPaused = false;
					Events.trigger(that, 'terminate');
					break;
				}
			}

			var preservedLength = this.options.simulation.preservedWorms;
			var wormLength = this.options.simulation.wormsPerGeneration;
			function proceedGeneration(genes, fitnesses, average) {
				var totalFitness = 0;
				for(var i = 0; i < count; i++) {
					that.worms[i].gene = Gene.fromJSON(genes[i]);
					that.worms[i].fitness = fitnesses[i];
					totalFitness += fitnesses[i];
				}

				Events.trigger(that, 'generationEnd', { // TODO event object not needed? these data are now open in Simulation obj
					generation: that.generation,
					worms: that.worms,
					averageFitness: average
				});

				var newWorms = [];

				for(var i = 0; i < preservedLength; i++) {
					newWorms[i] = new Worm(options, that.worms[i].gene);
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
					newWorms[i] = new Worm(options, newGene);
				}

				that.worms = newWorms;

				Events.trigger(that, 'generationStart');
			}

			function distributeGenes() {
				var genes = that.worms.map(function(worm) {
					return worm.gene.toJSON();
				});
				that._worker.postMessage({ 'type': "gene", 'genes': genes });
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

				this.generationTime = 0;
				this.totalEngineTime = 0;
				
				this._worker.postMessage({ 'type': "start" });
			},
			pause: function() {
				if(!this.isStarted || this.isPaused) return false;

				this._worker.postMessage({ 'type': "pause" });

				return this.isStarted && this.isPaused; // TODO return value has no meaning in this asynchronous code
			},
			resume: function() {
				if(!this.isStarted || !this.isPaused) return false;

				this._worker.postMessage({ 'type': "resume" });

				return this.isStarted && !this.isPaused;
			},
			terminate: function() {
				if(!this.isStarted) return false;

				this._worker.postMessage({ 'type': "terminate" });

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
				var blacklist = [
					'generationTime',
					'_distributeGenes',
					'isStarted', 'isPaused',
					'events'
				];
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
				sim.worms[i] = Worm.fromJSON(json.worms[i]);
			}
			sim._distributeGenes();

			var props = ['generation', 'totalEngineTime'];
			for(var i = 0; i < props.length; i++) {
				sim[props[i]] = json[props[i]];
			}

			sim.isStarted = true;
			sim.isPaused = true;
			return sim;
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


	Gene = (function() {
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


	Worm = (function() {
		function Worm(options, gene) {
			this.length = options.worm.length;
			this.width = options.worm.width;
			this.density = options.worm.density;
			this.joints = options.worm.joints;
			this.stiffness = options.worm.stiffness;
			this.friction = options.worm.friction;
			this.gene = new Gene(options, gene); // even if !gene, a gene will be generated randomly

			this.fitness = 0;

		}

		Worm.prototype = {
			toJSON: function() {
				var clone = {};
				var blacklist = ['events'];
				for(var key in this) {
					if(this.hasOwnProperty(key) && blacklist.indexOf(key) === -1) {
						clone[key] = this[key];
					}
				}
				return JSON.stringify(clone);
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
		};

		return Worm;
	})();


	return {
		Simulation: Simulation,
		Gene: Gene,
		Worm: Worm
	};
})();
