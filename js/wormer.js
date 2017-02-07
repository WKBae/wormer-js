"use strict";

var defaults = {
	simulation: {
		wormsPerGeneration: 20,
		preservedWorms: 3,
		timestep: 1000 / 60,
		speedFactor: 0,
		until: 15000,
		end: 50
	},
	worm: {
		width: 10,
		length: 100,
		foldings: 8,
		stiffness: 0.4,
		friction: 0.1
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

	var engines = [];
	var worms = [];
	var renders = [];

	var phase, period;
	var elaspedEngineTime, elaspedTotal;

	var generation;

	var stepTimeout = 0, doPause = false;

	var simulation;

	options = Common.extend(defaults, options);

	simulation = {
		start: start,
		pause: pause,
		resume: resume,
		on: function(eventNames, callback) {
			return Events.on(simulation, eventNames, callback);
		},
		off: function(eventNames, callback) {
			Events.off(simulation, eventNames, callback);
		},
		getWorms: function() {
			return worms;
		}
	};

	for(var i = 0; i < options.simulation.wormsPerGeneration; i++) {
		engines[i] = setupEngine(createEngine());
		worms[i] = createWorm(engines[i]);
		if(options.render.enabled) renders[i] = createRender(i, engines[i]);
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

		Events.trigger(simulation, 'setupEngine', {engine: engine});

		return engine;
	}

	function createWorm(engine, gene) {
		// @const
		var BEGIN_X = 50;

		var divLength = options.worm.length / options.worm.foldings;
		var halfWidth = options.worm.width / 2;
		var bodyParts = [];
		var constraints = [];
		for(var i = 0; i < options.worm.foldings; i++) {
			var newBody = Bodies.rectangle(BEGIN_X + divLength / 2 + divLength * i, WORLD_HEIGHT - halfWidth, divLength - 1, options.worm.width, {
				friction: options.worm.friction,
				render: {
					fillStyle: (i == options.worm.foldings - 2)? "#E77" : "#FAA",
					strokeStyle: "#F88"
				}
			});
			if(i > 0) {
				constraints.push(Constraint.create({
					bodyA: bodyParts[i - 1],
					pointA: { x: divLength / 2 - 1, y: -halfWidth },
					bodyB: newBody,
					pointB: { x: -divLength / 2, y: -halfWidth },
					stiffness: options.worm.stiffness,
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
					stiffness: options.worm.stiffness,
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
			element: options.render.createRenderWrapper(i),
			engine: engine,
			bounds: {
				min: { x: 0, y: 0 },
				max: { x: options.render.width / options.render.scale, y: options.render.height / options.render.scale }
			},
			options: {
				width: options.render.width,
				height: options.render.height,
				wireframes: false,
				hasBounds: true
			}
		});
	}

	function createRandomGene() {
		var gene = [];
		var constraintCount = (options.worm.foldings - 1) * 2;
		for(var i = 0; i < constraintCount; i++) {
			gene[i] = [];
			for(var j = 0; j < options.gene.phases / 32; j++) {
				gene[i][j] = Math.random() * (1 << 16) | 0;

				if(options.gene.phases >= j * 32 + 16) {
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
		for(var i = 0; i < (options.worm.foldings - 1) * 2; i++) {
			var point = (Math.random() * options.gene.phases) | 0;
			var pointLoc = (point / 32) | 0;
			var pointPos = point % 32;
			var pointMask = ((1 << pointPos) - 1) | 0;

			var newChrono = [];
			for(var j = 0; j < pointLoc; j++) {
				newChrono[j] = worm1.gene[i][j];
			}
			newChrono[pointLoc] = (worm1.gene[i][pointLoc] & pointMask) | (worm2.gene[i][pointLoc] & ~pointMask);
			for(var j = pointLoc + 1; j < options.gene.phases / 32; j++) {
				newChrono[j] = worm2.gene[i][j];
			}

			newGene[i] = newChrono;
		}
		return mutate(newGene, options);
	}

	function mutate(gene) {
		for(var i = 0; i < gene.length; i++) {
			for(var j = 0; j < /*gene[i].length*/ options.gene.phases / 32; j++) {
				for(var k = 0; k < 32 && j * 32 + k < options.gene.phases; k++) {
					if(Math.random() <= options.gene.mutation) {
						gene[i][j] ^= 1 << k
					}
				}
			}
		}
		return gene; // for chaining
	}

	function stepWorld() {
		Events.trigger(simulation, 'beforeTick');
		for(var i = 0; i < options.simulation.wormsPerGeneration; i++) {
			applyMovement(worms[i].constraints, worms[i].gene, phase);
			Engine.update(engines[i], options.simulation.timestep);
		}

		period++;
		if(period >= options.gene.period) {
			period = 0;
			phase++;
			if(phase >= options.gene.phases) {
				phase = 0;
			}
		}

		elaspedEngineTime += options.simulation.timestep;
		elaspedTotal += options.simulation.timestep;

		Events.trigger(simulation, 'afterTick tick', {
			engineTime: elaspedEngineTime,
			totalEngineTime: elaspedTotal
		});

		if(elaspedEngineTime < options.simulation.until) {
			stepTimeout = setTimeout(stepWorld, options.simulation.timestep * options.simulation.speedFactor);
		/* TODO
		} else if(generation >= options.simulation.end) {
			if(options.render.enabled) {
				for(var i = 0; i < renders.length; i++) {
					Render.stop(renders[i]);
				}
			}
			alert("Simulation done");
		*/
		} else {
			proceedGeneration();
			period = 0;
			phase = 0;
			elaspedEngineTime = 0;
			generation++;
			stepTimeout = setTimeout(stepWorld, options.simulation.timestep * options.simulation.speedFactor);
		}
	}
	
	function start() {
		period = 0;
		phase = 0;
		elaspedEngineTime = 0;
		elaspedTotal = 0;
		generation = 1;

		if(options.render.enabled) {
			for(var i = 0; i < renders.length; i++) {
				Render.run(renders[i]);
			}
		}

		Events.trigger(simulation, 'start');
		stepTimeout = setTimeout(stepWorld, 0);
	}

	function pause() {
		clearTimeout(stepTimeout);
		stepTimeout = 0;
		Events.trigger(simulation, 'pause');
	}
	function resume() {
		Events.trigger(simulation, 'resume');
		stepTimeout = setTimeout(stepWorld, 0);
	}

	function end() {
		clearTimeout(stepTimeout);
		stepTimeout = 0;
		/* TODO */
		Events.trigger(simulation, 'end');
	}

	function proceedGeneration() {
		var averageFitness;
		var totalFitness = 0;
		for(var i = 0; i < options.simulation.wormsPerGeneration; i++) {
			worms[i].fitness = fitness(worms[i]);

			totalFitness += worms[i].fitness;

			//setupEngine(engines[i]);
			World.clear(engines[i].world, true);
		}
		averageFitness = totalFitness / options.simulation.wormsPerGeneration;

		worms.sort(wormFitnessCompare);

		Events.trigger(simulation, 'generationEnd', {
			generation: generation,
			worms: worms,
			averageFitness: averageFitness
		});

		var newWorms = [];

		for(var i = 0; i < options.simulation.preservedWorms; i++) {
			newWorms[i] = createWorm(engines[i], worms[i].gene);
		}
		for(var i = options.simulation.preservedWorms; i < options.simulation.wormsPerGeneration; i++) {
			// Roulette wheel selection
			var selected1 = Math.random() * totalFitness,
				selected2 = Math.random() * totalFitness;
			var worm1 = null,
				worm2 = null;
			for(var j = 0; j < worms.length; j++) {
				selected1 -= fitness(worms[j]);
				selected2 -= fitness(worms[j]);

				if(selected1 <= 0 && !worm1) {
					worm1 = worms[j];
				}
				if(selected2 <= 0 && !worm2) {
					worm2 = worms[j];
				}
				if(worm1 && worm2) {
					break;
				}
			}
			var newGene = crossover(worm1, worm2);
			newWorms[i] = createWorm(engines[i], newGene)
		}

		worms = newWorms;
	}

	function addOnGenerationEndListener(listener) {
		generationListeners.push(listener); // TODO rename to generation end listener
	}

	return simulation;
}

$(function() {
	var graphData = [[0, [0, 0], [0, 0], [0, 0]]];
	var graph;
	var bestGenes = [null];
	function findBestGene(idx) {
		while(idx > 0 && !bestGenes[idx]) idx--;
		if(idx > 0) {
			return bestGenes[idx];
		} else {
			return null;
		}
	}
	function geneEquals(gene1, gene2) {
		if(gene1 === gene2) return true;
		if(gene1 == null || gene2 == null) return false;
		
		for(var i = 0; i < gene1.length; i++) {
			for(var j = 0; j < gene1[i].length; j++) {
				if(gene1[i][j] != gene2[i][j]) return false;
			}
		}
		return true;
	}

	$("#start").click(function() {
		$("#options").slideUp(function() {
			var options = {
				simulation: {
					wormsPerGeneration: parseInt($("#worms-per-gen").val(), 10),
					preservedWorms: parseInt($("#preserved-worms").val(), 10),
					speedFactor: parseFloat($("#speed").val()),
					until: parseInt($("#until").val(), 10),
					end: parseInt($("#end").val(), 10)
				},
				worm: {
					width: parseInt($("#width").val(), 10),
					length: parseInt($("#length").val(), 10),
					foldings: parseInt($("#foldings").val(), 10),
					stiffness: parseFloat($("#stiffness").val()),
					friction: parseFloat($("#friction").val())
				},
				gene: {
					phases: parseInt($("#phases").val(), 10),
					period: parseInt($("#period").val(), 10), // timesteps of world passed between each phase
					mutation: parseFloat($("#mutation").val())
				},
				render: {
					enabled: $("#doRender")[0].checked
				}
			};

			var simulation = setupSimulation(options);
			window.simulation = simulation;

			/*var genLabels = [0];
			var maxFitness = [0];
			var avgFitness = [0];*/

			/*var chart = new Chart($("#historyChart"), {
				type: 'line',
				data: {
					labels: genLabels,
					datasets: [
						{
							type: 'line',
							label: "Maximum fitness",
							backgroundColor: "rgba(255, 128, 128, 0.3)",
							borderColor: "rgba(255, 128, 128, 1)",
							pointBorderColor: "rgba(255, 128, 128, 1)",
							tension: 0,
							data: maxFitness
						},
						{
							type: 'line',
							label: "Average fitness",
							backgroundColor: "rgba(128, 128, 255, 0.3)",
							borderColor: "rgba(128, 128, 255, 1)",
							pointBorderColor: "rgba(128, 128, 255, 1)",
							tension: 0,
							data: avgFitness
						}
					]
				},
				options: {
					//tooltips: {mode:'index'},
					scales: {
						xAxes: [{
							ticks: {
								autoSkip: true,
								suggestedMin: 0
							}
						}],
						yAxes: [{
							ticks: {
								suggestedMin: 0,
								//suggestedMax: 100
							}
						}]
					}
				}
			});
			$("#historyChart").click(function(e) {
				var element = chart.getElementAtEvent(e);
				if(element && element.length == 1 && element[0]._datasetIndex == 0 /* Maximum fitness *) {
					console.log(bestGenes[element[0]._index]); // TODO show simulation
				}
			});*/
			var graphElem = document.getElementById("historyChart");
			graph = new Dygraph(graphElem, graphData, {
				xlabel: "Generations",
				ylabel: "Fitness",
				labels: ["x", "Max", "Avg", "Mid"],
				valueRange: [0, null],
				errorBars: true,
				legend: 'follow',
				labelsSeparateLines: true,
				//errorBars: true,
				showRangeSelector: true,
				pointClickCallback: function(e, point) {
					if(point.name == "Max") {
						findBestGene(point.idx) // simulate if not null
					}
				}
			});
			//graph.resize();

			$("#generation").text(1);
			$("#max-fitness").text(0);
			$("#avg-fitness").text(0);
			simulation.on('generationEnd', function(e) {
				var gen = e.generation;
				$("#generation").text(gen + 1);
				$("#max-fitness").text(e.worms[0].fitness.toFixed(3));
				$("#avg-fitness").text(e.averageFitness.toFixed(3));

				/*genLabels[gen] = e.generation;
				avgFitness[gen] = e.averageFitness;
				maxFitness[gen] = e.worms[0].fitness;
				bestGenes[gen] = e.worms[0].gene;*/

				var variance = 0;
				for(var i = 0; i < e.worms.length; i++) {
					variance += (e.averageFitness - e.worms[i].fitness) * (e.averageFitness - e.worms[i].fitness);
				}
				variance /= e.worms.length;

				graphData.push([e.generation, [e.worms[0].fitness, 0], [e.averageFitness, Math.sqrt(variance)], [e.worms[(e.worms.length / 2)|0].fitness, 0]]);
				graph.updateOptions({'file': graphData});
				//chart.update();

				if(!geneEquals(e.worms[0].gene, findBestGene(gen-1))) {
					bestGenes[gen] = e.worms[0].gene;
				}
			});
			$("#simulation").slideDown(function() {
				window.onbeforeunload = function() {
					return "Simulation is running. Are you sure to quit?";
				};
				simulation.start();
			});
		});
		return false;
	});

	$("#export-graph").click(function() {
		var elem = document.createElement('a');
		var csv = "\ufeffGeneration,Maximum,Average,Median\n"; // utf-8 BOM
		for(var i = 0; i < graphData.length; i++) {
			csv += graphData[i][0] + "," + graphData[i][1] + "," + graphData[i][2] + "," + graphData[i][3] + "\n";
		}
		elem.setAttribute('href', "data:text/csv;charset=utf8," + encodeURIComponent(csv));
		elem.setAttribute('download', "graph.csv");
		elem.style.display = "none";
		document.body.appendChild(elem);
		elem.click();
		document.body.removeChild(elem);
	});

	$("a[data-toggle=tab][href='#tab-history']").on('shown.bs.tab', function(e) {
		graph.resize();
	});
});
