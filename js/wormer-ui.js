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
				var duration = options.simulation.duration;
				var rerunOptions = {
					simulation: {
						wormsPerGeneration: 1,
						preservedWorms: 1,
						speedFactor: 1,
						duration: duration
					},
					worm: options.worm,
					gene: options.gene
				};
				var rerunSim = new Wormer.Simulation(rerunOptions);

				var $rerunProgress = $("#rerun-progress");
				var rerunProgress = $rerunProgress[0];
				var fitness = 0;
				rerunSim.on('start resume tick', function() {
					var progress = this.generationTime / duration * 100;
					//$rerunProgress.css('width', progress + "%");
					rerunProgress.style.width = progress + "%";
					//$rerunProgress.text((this.generationTime / 1000).toFixed(1) + "s");
					rerunProgress.innerHTML = (this.generationTime / 1000).toFixed(1) + "s";
					fitness = this.worms[0]._fitness();
				}).on('generationEnd', function() {
					//$rerunProgress.css('width', "0");
					rerunProgress.style.width = 0;
					//$rerunProgress.text("0.0s");
					rerunProgress.innerHTML = "0.0s";
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
				// Bootstrap default font
				rerunRender.context.font = "14px " + ($(document.body).css('font-family') || "\"Helvetica Neue\",Helvetica,Arial,sans-serif");
				rerunRender.context.textAlign = "left";
				rerunRender.context.textBaseLine = 	"top";
				Matter.Events.on(rerunRender, 'afterRender', function(e) {
					rerunRender.context.fillStyle = "#000000";
					rerunRender.context.fillText("Fitness: " + fitness.toFixed(3), 5, 15);
				});
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
				series: {
					'Max': { showInRangeSelector: true }
				},
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
				engineTime = this.generationTime;
				totalEngineTime = this.totalEngineTime;
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
			var options = readOptions();

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

	var elements = {
		simulation: {
			wormsPerGeneration: "#worms-per-gen",
			preservedWorms: "#preserved-worms",
			speedFactor: "#speed",
			duration: "#duration"
		},
		worm: {
			width: "#width",
			length: "#length",
			density: "#density",
			joints: "#joints",
			stiffness: "#stiffness",
			friction: "#friction"
		},
		gene: {
			phases: "#phases",
			period: "#period", // timesteps of world passed between each phase
			mutation: "#mutation"
		}
	};

	function applyOptions(options) {
		var applied = 0;

		(function iterate(options, elements) {
			if(!options || !elements) return;

			for(var key in options) {
				if(options.hasOwnProperty(key) && elements.hasOwnProperty(key)) {
					if(typeof elements[key] === 'string') {
						$(elements[key]).val(options[key]);
						applied++;
					} else {
						iterate(options[key], elements[key]);
					}
				}
			}
		})(options, elements);
		return applied;
	}

	function readOptions(options) {
		var result = {};

		(function iterate(result, elements) {
			if(!result || !elements) return;
			
			for(var key in elements) {
				if(elements.hasOwnProperty(key)) {
					if(typeof elements[key] === 'string') {
						result[key] = parseFloat($(elements[key]).val());
					} else {
						result[key] = {};
						iterate(result[key], elements[key]);
					}
				}
			}
		})(result, elements);
		return result;
	}

	function loadOptions(file) {
		var reader = new FileReader();
		reader.onload = function(e) {
			var content = e.target.result;
			var options;
			var $alert;
			try {
				options = JSON.parse(content);

				if(applyOptions(options) > 0) {
					$alert = $(".options-load-success");
				} else {
					$alert = $(".options-load-warning");
				}
			} catch(e) {
				$alert = $(".options-load-failed");
			}
			$alert.first().clone()
				.insertAfter($(".options-load-alert").last())
				.css("display", "")
				.addClass("in");
		}
		reader.readAsText(file);
	}

	function loadSimulation(file, asText) {
		var reader = new FileReader();
		var json;
		if(!asText) {
			reader.onload = function(e) {
				var contents = e.target.result;
				var arr = new Uint8Array(contents);
				try {
					var str = LZString.decompressFromUint8Array(arr);
					json = JSON.parse(str);
					simulation = Wormer.Simulation.fromJSON(json.simulation);
				} catch(e) {
					console.warn(e);
					loadSimulation(file, true);
					return;
				}

				startSimulation();
			};
			reader.readAsArrayBuffer(file);
		} else {
			reader.onload = function(e) {
				var str = e.target.result;
				try {
					json = JSON.parse(str);
					simulation = Wormer.Simulation.fromJSON(json.simulation);
				} catch(e) {
					console.error(e);
					$(".options-load-failed").first().clone()
						.insertAfter($(".options-load-alert").last())
						.css("display", "")
						.addClass("in");
					return;
				}

				startSimulation();
			};
			reader.readAsText(file);
		}

		function startSimulation() {
			$("#options").slideUp(function() {
				setupForSimulation(simulation); // TODO remove duplicate code

				graphData = json.graph;
				bestGenes = json.genes;

				window.onbeforeunload = function(e) {
					return e.returnValue = "Simulation is running. Are you sure to quit?";
				};
				
				Matter.Events.trigger(simulation, 'pause');

				$("#simulation").slideDown();
			});
		}
	}

	function saveSimulation(simulation) {
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
	}
	function saveOptions(options) {
		var json = JSON.stringify(options);

		var elem = document.createElement('a');
		elem.setAttribute('href', "data:text/json;charset=utf8," + encodeURIComponent(json));
		elem.setAttribute('download', "options.json");
		elem.style.display = "none";
		document.body.appendChild(elem);
		elem.click();
		document.body.removeChild(elem);
	}

	function saveGraph(graphData, bestGenes) {
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
	}

	$("#import-options").change(function() {
		if(this.files && this.files.length >= 1) {
			var file = this.files[0];
			loadOptions(file);
		}
	});

	$("#import-simulation").change(function() {
		if(this.files && this.files.length >= 1) {
			loadSimulation(this.files[0]);
		}
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

	});

	$("#export-options").click(function() {
		if(!simulation) return;
		saveOptions(simulation.options);
	});
	$("#export-statics").click(function() {
		if(!simulation) return;
		saveGraph(graphData, bestGenes);
	});

	$("a[data-toggle=tab][href='#tab-statics']").on('shown.bs.tab', function(e) {
		graph.resize();
	});
});
