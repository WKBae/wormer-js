"use strict";

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

function setupSimulation(options) {
	// @const
	var Common = Matter.Common,
		Events = Matter.Events,
		Engine = Matter.Engine,
		Render = Matter.Render,
		World = Matter.World,
		Body = Matter.Body,
		Bodies = Matter.Bodies,
		Constraint = Matter.Constraint;

	// @const
	var WORLD_WIDTH = 2000,
		WORLD_HEIGHT = 300;

	var sim = {
		start: start,
		pause: pause,
		resume: resume,
		terminate: terminate,

		on: function(eventNames, callback) {
			return Events.on(sim, eventNames, callback);
		},
		off: function(eventNames, callback) {
			Events.off(sim, eventNames, callback);
		},

		_options: Common.extend(defaults, options),
		
		_engines: [],
		_worms: [],

		_generation: 0,

		_phase: 0,
		_period: 0,
		_engineTime: 0,
		_totalEngineTime: 0,

		_isStarted: false,
		_stepTimeout: 0,
		_isPaused: false
	};

	for(var i = 0; i < sim._options.simulation.wormsPerGeneration; i++) {
		sim._engines[i] = setupEngine(createEngine());
		sim._worms[i] = createWorm(sim._engines[i]);
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

		Events.trigger(sim, 'setupEngine', {engine: engine});

		return engine;
	}

	function createWorm(engine, gene) {
		// @const
		var BEGIN_X = 50;

		var divLength = sim._options.worm.length / sim._options.worm.joints;
		var halfWidth = sim._options.worm.width / 2;
		var bodyParts = [];
		var constraints = [];
		for(var i = 0; i < sim._options.worm.joints; i++) {
			var newBody = Bodies.rectangle(BEGIN_X + divLength / 2 + divLength * i, WORLD_HEIGHT - halfWidth, divLength - 1, sim._options.worm.width, {
				friction: sim._options.worm.friction,
				render: {
					fillStyle: (i == sim._options.worm.joints - 2)? "#E77" : "#FAA",
					strokeStyle: "#F88"
				}
			});
			if(i > 0) {
				constraints.push(Constraint.create({
					bodyA: bodyParts[i - 1],
					pointA: { x: divLength / 2 - 1, y: -halfWidth },
					bodyB: newBody,
					pointB: { x: -divLength / 2, y: -halfWidth },
					stiffness: sim._options.worm.stiffness,
					length: 2,
					render: {
						strokeStyle: "#F88"
					}
				}));
				constraints.push(Constraint.create({
					bodyA: bodyParts[i - 1],
					pointA: { x: divLength / 2 - 1, y: halfWidth },
					bodyB: newBody,
					pointB: { x: -divLength / 2, y: halfWidth },
					stiffness: sim._options.worm.stiffness,
					length: 2,
					render: {
						strokeStyle: "#F88"
					}
				}));
			}
			bodyParts.push(newBody);
		}

		World.add(engine.world, bodyParts);
		World.add(engine.world, constraints);

		return {
			body: bodyParts,
			constraints: constraints,
			gene: gene? gene : createRandomGene()
		};
	}

	function createRender(i, engine) {
		return Render.create({
			element: sim._options.render.createRenderWrapper(i),
			engine: engine,
			bounds: {
				min: { x: 0, y: 0 },
				max: { x: sim._options.render.width / sim._options.render.scale, y: sim._options.render.height / sim._options.render.scale }
			},
			options: {
				width: sim._options.render.width,
				height: sim._options.render.height,
				wireframes: false,
				hasBounds: true
			}
		});
	}

	function createRandomGene() {
		var gene = [];
		var constraintCount = (sim._options.worm.joints - 1) * 2;
		for(var i = 0; i < constraintCount; i++) {
			gene[i] = [];
			for(var j = 0; j < sim._options.gene.phases / 32; j++) {
				gene[i][j] = Math.random() * (1 << 16) | 0;

				if(sim._options.gene.phases >= j * 32 + 16) {
					gene[i][j] |= Math.random() * (1 << 16) << 16;
				}
			}
		}
		return gene;
	}

	function applyMovement(constraints, gene, phase) {
		for(var i = 0; i < constraints.length; i++) {
			var j = (phase / 32) | 0; // phase >> 5
			var k = phase % 32; // phase & 31
			constraints[i].length = ((gene[i][j] & (1 << k)) != 0)? 6 : 2;
		}
	}

	function fitness(worm) {
		var minX = Infinity;
		for(var i = 0; i < worm.body.length; i++) {
			minX = Math.min(minX, worm.body[i].position.x);
		}
		return minX;
	}

	function wormFitnessCompare(worm1, worm2) {
		return worm2.fitness - worm1.fitness;
	}

	function crossover(worm1, worm2) {
		var newGene = [];
		for(var i = 0; i < (sim._options.worm.joints - 1) * 2; i++) {
			var point = (Math.random() * sim._options.gene.phases) | 0;
			var pointLoc = (point / 32) | 0;
			var pointPos = point % 32;
			var pointMask = ((1 << pointPos) - 1) | 0;

			var newChrono = [];
			for(var j = 0; j < pointLoc; j++) {
				newChrono[j] = worm1.gene[i][j];
			}
			newChrono[pointLoc] = (worm1.gene[i][pointLoc] & pointMask) | (worm2.gene[i][pointLoc] & ~pointMask);
			for(var j = pointLoc + 1; j < sim._options.gene.phases / 32; j++) {
				newChrono[j] = worm2.gene[i][j];
			}

			newGene[i] = newChrono;
		}
		return mutate(newGene, options);
	}

	function mutate(gene) {
		for(var i = 0; i < gene.length; i++) {
			for(var j = 0; j < /*gene[i].length*/ sim._options.gene.phases / 32; j++) {
				for(var k = 0; k < 32 && j * 32 + k < sim._options.gene.phases; k++) {
					if(Math.random() <= sim._options.gene.mutation) {
						gene[i][j] ^= 1 << k
					}
				}
			}
		}
		return gene; // for chaining
	}

	function stepWorld() {
		Events.trigger(sim, 'beforeTick');
		for(var i = 0; i < sim._options.simulation.wormsPerGeneration; i++) {
			applyMovement(sim._worms[i].constraints, sim._worms[i].gene, sim._phase);
			Engine.update(sim._engines[i], sim._options.simulation.timestep);
		}

		sim._period++;
		if(sim._period >= sim._options.gene.period) {
			sim._period = 0;
			sim._phase++;
			if(sim._phase >= sim._options.gene.phases) {
				sim._phase = 0;
			}
		}

		sim._engineTime += sim._options.simulation.timestep;
		sim._totalEngineTime += sim._options.simulation.timestep;

		Events.trigger(sim, 'afterTick tick', {
			engineTime: sim._engineTime,
			totalEngineTime: sim._totalEngineTime
		});

		if(sim._engineTime < sim._options.simulation.duration) {
			sim._stepTimeout = setTimeout(stepWorld, sim._options.simulation.timestep * sim._options.simulation.speedFactor);
		} else {
			proceedGeneration();
			sim._period = 0;
			sim._phase = 0;
			sim._engineTime = 0;
			sim._generation++;
			sim._stepTimeout = setTimeout(stepWorld, sim._options.simulation.timestep * sim._options.simulation.speedFactor);
		}
	}
	
	function start() {
		if(sim._isStarted) {
			if(sim._isPaused) {
				resume();
			}
			return;
		}

		sim._period = 0;
		sim._phase = 0;
		sim._engineTime = 0;
		sim._totalEngineTime = 0;
		sim._generation = 1;
		sim._isStarted = true;
		sim._isPaused = false;

		if(sim._options.render.enabled) {
			for(var i = 0; i < renders.length; i++) {
				Render.run(renders[i]);
			}
		}

		Events.trigger(sim, 'start', {
			options: sim._options
		});
		sim._stepTimeout = setTimeout(stepWorld, 0);
	}

	function pause() {
		if(!sim._isStarted || sim._isPaused) return false;

		clearTimeout(sim._stepTimeout);
		sim._stepTimeout = 0;
		sim._isPaused = true;

		Events.trigger(sim, 'pause');

		return sim._isStarted && sim._isPaused; // state can be changed in event handlers
	}
	function resume() {
		if(!sim._isStarted || !sim._isPaused) return false;

		sim._isPaused = false;
		sim._stepTimeout = setTimeout(stepWorld, 0);

		Events.trigger(sim, 'resume');

		return sim._isStarted && !sim._isPaused;
	}

	function terminate() {
		if(!sim._isStarted) return false;

		clearTimeout(sim._stepTimeout);
		sim._stepTimeout = 0;
		sim._isStarted = false;
		sim._isPaused = false;
		
		Events.trigger(sim, 'terminate');

		return !sim._isStarted;
	}

	function proceedGeneration() {
		var averageFitness;
		var totalFitness = 0;
		for(var i = 0; i < sim._options.simulation.wormsPerGeneration; i++) {
			sim._worms[i].fitness = fitness(sim._worms[i]);

			totalFitness += sim._worms[i].fitness;

			//setupEngine(sim._engines[i]);
			World.clear(sim._engines[i].world, true);
		}
		averageFitness = totalFitness / sim._options.simulation.wormsPerGeneration;

		sim._worms.sort(wormFitnessCompare);

		Events.trigger(sim, 'generationEnd', {
			generation: sim._generation,
			worms: sim._worms,
			averageFitness: averageFitness
		});

		var newWorms = [];

		for(var i = 0; i < sim._options.simulation.preservedWorms; i++) {
			newWorms[i] = createWorm(sim._engines[i], sim._worms[i].gene);
		}
		for(var i = sim._options.simulation.preservedWorms; i < sim._options.simulation.wormsPerGeneration; i++) {
			// Roulette wheel selection
			var selected1 = Math.random() * totalFitness,
				selected2 = Math.random() * totalFitness;
			var worm1 = null,
				worm2 = null;
			for(var j = 0; j < sim._worms.length; j++) {
				selected1 -= fitness(sim._worms[j]);
				selected2 -= fitness(sim._worms[j]);

				if(selected1 <= 0 && !worm1) {
					worm1 = sim._worms[j];
				}
				if(selected2 <= 0 && !worm2) {
					worm2 = sim._worms[j];
				}
				if(worm1 && worm2) {
					break;
				}
			}
			var newGene = crossover(worm1, worm2);
			newWorms[i] = createWorm(sim._engines[i], newGene)
		}

		sim._worms = newWorms;
	}

	function addOnGenerationEndListener(listener) {
		generationListeners.push(listener); // TODO rename to generation end listener
	}

	return sim;
}
