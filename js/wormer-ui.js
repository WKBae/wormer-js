"use strict";

$(function() {
	var simulation;
	var graphData;
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

	function createRender(engine, target) {
		// @const
		var renderOptions = {
			width: 2000,
			height: 150,
			scale: 0.5
		};

		var render = Matter.Render.create({
			element: $('<div class="render col-xs-12"></div>').appendTo(target)[0],
			engine: engine,
			bounds: {
				min: { x: 0, y: 0 },
				max: { x: renderOptions.width / renderOptions.scale, y: renderOptions.height / renderOptions.scale }
			},
			options: {
				width: renderOptions.width,
				height: renderOptions.height,
				wireframes: false,
				hasBounds: true
			}
		});
		//Matter.Events.on(render, 'afterRender', function() {
		//	this.context.fillText(this.engine."")
		//});
		return render;
	}

	function loadSimulation(file) {
		var reader = new FileReader();
		reader.onload = function(e) {
			var contents = e.target.result;
			debugger;
		};
		reader.readAsArrayBuffer(file);
	}

	function setupForSimulation(simulation) {
		var options = simulation.options;

		(function showOptions(obj, prefix) {
			for(var name in obj) {
				if(typeof obj[name] === 'object') {
					showOptions(obj[name], prefix + "-" + name);
				} else {
					$(prefix + "-" + name).text(obj[name]);
				}
			}
		})(options, ".info-option");

		(function staticsUpdater() {
			var $generation = $(".info-generation");
			var $currentGen = $(".info-current-gen");
			var $maxFitness = $(".info-fitness-max");
			var $avgFitness = $(".info-fitness-avg");
			var $midFitness = $(".info-fitness-mid");
			var $stdevFitness = $(".info-fitness-stdev");

			// @const
			var showDeviation = false;

			function defaultValues() {
				$generation.text(0);
				$currentGen.text(1);
				$maxFitness.text(0);
				$avgFitness.text(0);
				$midFitness.text(0);

				if(showDeviation) {
					graphData = [[0, [0, 0], [0, 0], [0, 0]]];
				} else {
					graphData = [[0, 0, 0, 0]];
				}
			}
			simulation.on('start', defaultValues);
			defaultValues();
			
			var rerun = (function setupRerun() {
				var rerunOptions = {
					simulation: {
						wormsPerGeneration: 1,
						preservedWorms: 1,
						speedFactor: 1,
						duration: options.simulation.duration
					},
					worm: options.worm,
					gene: options.gene
				};
				var rerunSim = new Wormer.Simulation(rerunOptions);

				var $rerunProgress = $("#rerun-progress");
				rerunSim.on('start resume tick', function() {
					var progress = this.generationTime / rerunOptions.simulation.duration * 100;
					$rerunProgress.css('width', progress + "%");
					$rerunProgress.text((this.generationTime / 1000).toFixed(1) + "s");
				}).on('generationEnd', function() {
					$rerunProgress.css('width', "0");
					$rerunProgress.text("0.0s");
					this.pause();
				}).on('start resume', function() {
					$rerunProgress.removeClass('active progress-bar-success progress-bar-warning progress-bar-danger')
									.addClass('active progress-bar-success');
				}).on('pause', function() {
					$rerunProgress.removeClass('active progress-bar-success progress-bar-warning progress-bar-danger')
									.addClass('progress-bar-warning');
				}).on('terminate', function() {
					$rerunProgress.removeClass('active progress-bar-success progress-bar-warning progress-bar-danger')
									.addClass('progress-bar-danger');
				});

				var rerunRender = createRender(rerunSim.engines[0], "#rerun-render");
				$(rerunRender.canvas).click(function() {
					if(rerunSim.isPaused) rerunSim.resume();
					else if(rerunSim.isStarted) rerunSim.pause();
				});
				Matter.Render.run(rerunRender);

				return rerunSim;
			})();

			graph = new Dygraph("historyChart", graphData, {
				xlabel: "Generations",
				ylabel: "Fitness",
				labels: ["x", "Max", "Avg", "Mid"],
				valueRange: [0, null],
				errorBars: showDeviation,
				legend: 'follow',
				labelsSeparateLines: true,
				//errorBars: true,
				showRangeSelector: true,
				clickCallback: function(e, x, points) {
					var point = points[0];
					if(point && point.xval) {
						rerun.terminate();
						var gene = findBestGene(point.xval);
						rerun.worms[0].gene = Wormer.Gene.fromJSON(gene);
						rerun.worms[0].detach(true).attachTo(rerun.engines[0]);
						rerun.start();
						$("#rerun-gen").text(point.xval);
					}
				}
			});

			simulation.on('generationEnd', function(e) {
				var gen = e.generation;
				var best = e.worms[0].fitness;
				var average = e.averageFitness;
				var variance = 0;
				for(var i = 0; i < e.worms.length; i++) {
					variance += (average - e.worms[i].fitness) * (average - e.worms[i].fitness);
				}
				variance /= e.worms.length;
				var stdev = Math.sqrt(variance);
				var median = e.worms[(e.worms.length / 2)|0].fitness;

				$generation.text(gen);
				$currentGen.text(gen + 1);
				$maxFitness.text(best.toFixed(3));
				$avgFitness.text(average.toFixed(3));
				$midFitness.text(median.toFixed(3));
				$stdevFitness.text(stdev.toFixed(3));

				if(showDeviation) {
					graphData.push([gen, [best, 0], [average, Math.sqrt(variance)], [median, 0]]);
				} else {
					graphData.push([gen, best, average, median]);
				}
				
				graph.updateOptions({'file': graphData});
				//chart.update();

				var newGene = e.worms[0].gene.toJSON();
				if(newGene != findBestGene(e.generation - 1)) {
					bestGenes[gen] = e.worms[0].gene.toJSON();
				}
			});
		})();

		(function stateUpdater() {
			var $state = $(".info-state");
			var $panel = $("#simulation-panel");
			var $start = $("#simulation-start");
			var $stop = $("#simulation-pause");

			$state.text("Terminated");
			$start.prop('disabled', false);
			$stop.prop('disabled', true);

			simulation.on('start resume', function(e) {
				$panel.removeClass("panel-primary panel-success panel-info panel-warning panel-danger")
					.addClass("panel-info");
				$state.text("Running");

				$start.prop('disabled', true);
				$stop.prop('disabled', false);
			}).on('pause', function(e) {
				$panel.removeClass("panel-primary panel-success panel-info panel-warning panel-danger")
					.addClass("panel-warning");
				$state.text("Paused");

				$start.prop('disabled', false);
				$stop.prop('disabled', true);
			}).on('terminate', function(e) {
				$panel.removeClass("panel-primary panel-success panel-info panel-warning panel-danger")
					.addClass("panel-danger");
				$state.text("Terminated");

				$start.prop('disabled', false);
				$stop.prop('disabled', true);
			});
		})();

		(function timeUpdater() {
			var engineTime = 0;
			var totalEngineTime = 0;

			var timeStarted = 0;
			var timeOffset = 0;

			simulation.on('start', function(e) {
				timeOffset = 0;
				timeStarted = Date.now();
			}).on('resume', function(e) {
				timeStarted = Date.now();
			}).on('pause terminate', function(e) {
				timeOffset += Date.now() - timeStarted;
				timeStarted = 0;
			}).on('tick', function(e) {
				engineTime = e.engineTime;
				totalEngineTime = e.totalEngineTime;
			});

			var simulationTime = $(".info-time-simulation")[0];
			var totalTime = $(".info-time-total")[0];

			(function updateTimeLabels() {
				//$simulationTime.text((totalEngineTime / 1000).toFixed(2) + "s");
				simulationTime.innerHTML = (totalEngineTime / 1000).toFixed(2) + "s";

				var runningTime = timeStarted > 0? Date.now() - timeStarted : 0;
				//$totalTime.text(((runningTime + timeOffset) / 1000).toFixed(2) + "s");
				totalTime.innerHTML = ((runningTime + timeOffset) / 1000).toFixed(2) + "s";

				requestAnimationFrame(updateTimeLabels);
			})();
			//setInterval(updateTimeLabels, 100);
		})();
	}

	$("#start").click(function() {
		$("#options").slideUp(function() {
			var options = {
				simulation: {
					wormsPerGeneration: parseInt($("#worms-per-gen").val(), 10),
					preservedWorms: parseInt($("#preserved-worms").val(), 10),
					speedFactor: parseFloat($("#speed").val()),
					duration: parseInt($("#duration").val(), 10)
				},
				worm: {
					width: parseInt($("#width").val(), 10),
					length: parseInt($("#length").val(), 10),
					joints: parseInt($("#joints").val(), 10),
					stiffness: parseFloat($("#stiffness").val()),
					friction: parseFloat($("#friction").val())
				},
				gene: {
					phases: parseInt($("#phases").val(), 10),
					period: parseInt($("#period").val(), 10), // timesteps of world passed between each phase
					mutation: parseFloat($("#mutation").val())
				}
			};

			simulation = new Wormer.Simulation(options);

			setupForSimulation(simulation);
			
			$("#simulation").slideDown(function() {
				$(window).on('beforeunload', function(e) {
					return e.returnValue = "Simulation is running. Are you sure to quit?";
				});
			});
		});
		return false;
	});
	
	$("#simulation-start").click(function() {
		if(simulation) simulation.start();
	});
	$("#simulation-pause").click(function() {
		if(simulation) simulation.pause();
	});
	$("#simulation-terminate").click(function() {
		if(simulation) simulation.terminate();
	});

	$("#export-simulation").click(function() {
		if(!simulation) return;

		var saveData = {
			simulation: simulation,
			graph: graphData,
			genes: bestGenes
		};
		var compress = true;

		var json = JSON.stringify(saveData);
		var data;
		if(compress) {
			json = LZString.compressToBase64(json);
			data = "data:application/octet-stream;base64," + encodeURIComponent(json);
		} else {
			data = "data:text/json;charset=utf8," + encodeURIComponent(json);
		}

		var elem = document.createElement('a');
		elem.setAttribute('href', data);
		elem.setAttribute('download', "simulation.bin");
		elem.style.display = "none";
		document.body.appendChild(elem);
		elem.click();
		document.body.removeChild(elem);
	});

	$("#export-options").click(function() {
		if(!simulation) return;

		var json = JSON.stringify(options);

		var elem = document.createElement('a');
		elem.setAttribute('href', "data:text/json;charset=utf8," + encodeURIComponent(json));
		elem.setAttribute('download', "options.json");
		elem.style.display = "none";
		document.body.appendChild(elem);
		elem.click();
		document.body.removeChild(elem);
	});
	$("#export-statics").click(function() {
		if(!simulation) return;

		var csv = "\ufeffGeneration,Maximum,Average,Median,Gene\n"; // utf-8 BOM
		for(var i = 0; i < graphData.length; i++) {
			csv += graphData[i][0] + "," + graphData[i][1] + "," + graphData[i][2] + "," + graphData[i][3] + ","
					+ (bestGenes[i]? '"' + JSON.stringify(bestGenes[i]) + '"' : "") + "\n";
		}

		var elem = document.createElement('a');
		elem.setAttribute('href', "data:text/csv;charset=utf8," + encodeURIComponent(csv));
		elem.setAttribute('download', "graph.csv");
		elem.style.display = "none";
		document.body.appendChild(elem);
		elem.click();
		document.body.removeChild(elem);
	});

	$("a[data-toggle=tab][href='#tab-statics']").on('shown.bs.tab', function(e) {
		graph.resize();
	});
});
