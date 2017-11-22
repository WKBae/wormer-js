"use strict"

// TODO move these to setup
const wormsPerWorker = 3;
const childsPerWorker = 5;

var workerId;

var isParent;
var childs;
var simulation;
var wormCount;

var doneGenes;
var doneFitness;

self.onmessage = function(e) {
	var data = e.data;
	//console.log(data);
	if(data.type === "canNest") {
		self.postMessage({ 'type': "nest", 'nestable': Worker? true : false }); // TODO implement non-nested worker
	} else if(data.type === "setup") {
		var count = data.count;
		var options = data.options;
		workerId = data.id || "1";
		if(count > wormsPerWorker) { // TODO childsPerWorker goes before wormsPerWorker. having same worm count(and less workers) will perform better
			isParent = true;

			doneGenes = [];
			doneFitness = [];
console.log("Worker " + workerId + ", parent, count "  +count);
			var prevCount = 0;
			if(childs && childs.length > 0) {
				prevCount = childs.length;
				for(var i = 0; i < prevCount; i++) {
					childs[i] = {
						'id': workerId + "-" + (i+1),
						'worker': childs[i].worker,
						'isSetUp': false,
						'isStarted': false,
						'isPaused': false,
						'progress': 0,
						'count': ((count/childsPerWorker)|0) + (count%childsPerWorker > i? 1 : 0)
					};
					childs[i].worker.postMessage({ 'type': "setup", 'count': childs[i].count, 'options': options, 'id': childs[i].id });
				}
			} else {
				childs = [];
			}
			for(var i = prevCount; i < childsPerWorker; i++) {
				childs[i] = {
					'id': workerId + "-" + (i+1),
					'worker': new Worker('wormer-nested-worker.js'),
					'isSetUp': false,
					'isStarted': false,
					'isPaused': false,
					'progress': 0,
					'count': ((count/childsPerWorker)|0) + (count%childsPerWorker > i? 1 : 0)
				};
				childs[i].worker.onmessage = childMessage(i);
				childs[i].worker.postMessage({ 'type': "setup", 'count': childs[i].count, 'options': options, 'id': childs[i].id });
			}
		} else {
			isParent = false;

			if(childs && childs.length > 0) {
				for(var i = 0; i < childs.length; i++) {
					childs[i].worker.terminate();
				}
				childs = null;
			}
			if(simulation) {
				simulation.terminate();
			}
			wormCount = count;
			importScripts('matter.min.js', 'wormer.js');
			options.simulation.wormsPerGeneration = wormCount;
			options.simulation.preservedWorms = wormCount;
			simulation = new Wormer.Simulation(options);
			setupSimulation();

			self.postMessage({ 'type': "setupDone" });console.log("Worker " + workerId + " setup done, count " + count);
		}
	} else if(isParent) {
		switch(data.type) {
		case "gene":
			var genes = data.genes;
			var countSum = 0;
			for(var i = 0; i < childsPerWorker; i++) {
				childs[i].worker.postMessage({ 'type': "gene", 'genes': genes.slice(countSum, countSum + childs[i].count)});
				countSum += childs[i].count;
			}
			break;
		case "start":
			childs.forEach(function(child) {
				//if(!child.isStarted)
					child.worker.postMessage(data);
			});
			break;
		case "pause":
			childs.forEach(function(child) {
				//if(child.isStarted && !child.isPaused)
					child.worker.postMessage(data);
			});
			break;
		case "resume":
			childs.forEach(function(child) {
				//if(child.isStarted && child.isPaused)
					child.worker.postMessage(data);
			});
			break;
		case "terminate":
			childs.forEach(function(child) {
				//if(child.isStarted)
					child.worker.postMessage(data);
			});
			break;
		}
	} else {
		switch(data.type) {
		case "gene":
			var genes = data.genes;
			for(var i = 0; i < wormCount; i++) {
				simulation.worms[i].gene = Wormer.Gene.fromJSON(genes[i]);
			}
			break;
		case "start":
			simulation.start();
			break;
		case "pause":
			simulation.pause();
			self.postMessage({ 'type': "progress", 'progress': simulation.generationTime / simulation.options.simulation.duration });
			break;
		case "resume":
			simulation.resume();
			break;
		case "terminate":
			simulation.terminate();
			// self.stop();
			break;
		}
	}
}
// TODO sometimes "pause" is ignored, without "paused" message, when toggling pause frequently, usually on generation end
// TODO after resolved, remove console.log mess
function setupSimulation() {
	const reportRate = 0.05; // every 5%
	var duration = simulation.options.simulation.duration;
	var step = simulation.options.simulation.timestep;
	var ticks = Math.floor((duration / step) * reportRate);
	var current = 0;
	var genMessage = null;

	simulation.on('generationStart', function() {
		current = 0;
		//self.postMessage({ 'type': "progress", 'progress': 0 });
	}).on('tick', function() {
		current++;
		if(current >= ticks) {
			current = 0;
			self.postMessage({ 'type': "progress", 'progress': this.generationTime / duration }); // TODO fix progress reversing on generation end
		}
	}).on('generationEnd', function(e) {
		var genes = e.worms.map(function(worm) {
			return worm.gene.toJSON();
		});
		var fitness = e.worms.map(function(worm) {
			return worm.fitness;
		});
		var average = e.averageFitness;
		self.postMessage({ 'type': "progress", 'progress': 1 });
		//self.postMessage({ 'type': "generationEnd", 'genes': genes, 'fitness': fitness, 'average': average });
		genMessage = { 'type': "generationEnd", 'genes': genes, 'fitness': fitness, 'average': average };
		this.pause();
	}).on('start', function() {
		self.postMessage({ 'type': "started" });
	}).on('resume', function() {
		self.postMessage({ 'type': "resumed" });
	}).on('pause', function() {console.log(workerId, "Paused, genMessage:", genMessage);
		if(genMessage) {
			self.postMessage(genMessage);
			genMessage = null;
		} else {
			self.postMessage({ 'type': "paused" });
		}
	}).on('terminate', function() {
		self.postMessage({ 'type': "terminated" });
	});
}

var lastProgress = 0;
function childMessage(id) {
	return function(e) {
		var data = e.data;
		var type = data.type;
		switch(type) {
		case "progress":
			(function(id, data) {
				childs[id].progress = data.progress;
				var totalProgress = 0;
				for(var i = 0; i < childsPerWorker; i++) {
					totalProgress += childs[i].progress;
				}
				var avgProgress = totalProgress / childsPerWorker;
				if(Math.abs(lastProgress - avgProgress) >= 0.05) {
					self.postMessage({ 'type': "progress", 'progress': avgProgress });
					lastProgress = avgProgress;
				}
			})(id, data);
			break;
		case "generationEnd":
			(function(id, data) {
				doneGenes.push(data.genes);
				doneFitness.push(data.fitness);
				childs[id].isPaused = true;

				if(doneGenes.length >= childsPerWorker) {
					/* Merge sort, genes and fitnesses are posted after being sorted */
					var total = 0;
					var idx = [];
					for(var i = 0; i < childsPerWorker; i++) {
						total += doneGenes[i].length;
						idx[i] = 0;
					}console.log(workerId, "done " + doneGenes.length, "childs " + childs.length, "total " + total);

					var fitnessSum = 0;
					var resGenes = [];
					var resFitness = [];
					for(var count = 0; count < total; count++) {
						var maxFitness = -Infinity;
						var maxI = 0;
						for(var i = 0; i < childsPerWorker; i++) {
							if(idx[i] < doneGenes[i].length && doneFitness[i][idx[i]] > maxFitness) {
								maxFitness = doneFitness[i][idx[i]];
								maxI = i;
							}
						}
						resGenes[count] = doneGenes[maxI][idx[maxI]];
						resFitness[count] = doneFitness[maxI][idx[maxI]];
						idx[maxI]++;
						fitnessSum += resFitness[count];
					}
					self.postMessage({ 'type': "generationEnd", 'genes': resGenes, 'fitness': resFitness, 'average': fitnessSum / total });
					doneGenes = [];
					doneFitness = [];
				}
			})(id, data);
			break;
		case "setupDone":
			(function(id, data) {
				childs[id].isSetUp = true;
				var num;
				for(num = 0; num < childsPerWorker; num++) {
					if(!childs[num].isSetUp) break;
				}
				if(num === childsPerWorker) {
					self.postMessage({ 'type': "setupDone" });
				}
			})(id, data);
			break;
		case "started":
			(function(id, data) {
				childs[id].isStarted = true;
				childs[id].isPaused = false;
				var num;
				for(num = 0; num < childsPerWorker; num++) {
					if(!childs[num].isStarted) break;
				}
				if(num === childsPerWorker) {
					self.postMessage({ 'type': "started" });
				}
			})(id, data);
			break;
		case "paused":
			(function(id, data) {
				childs[id].isPaused = true;
				var num;
				for(num = 0; num < childsPerWorker; num++) {
					if(!childs[num].isPaused) break;
				}
				if(num === childsPerWorker) {
					self.postMessage({ 'type': "paused" });
				}
			})(id, data);
			break;
		case "resumed":
			(function(id, data) {
				childs[id].isPaused = false;
				var num;
				for(num = 0; num < childsPerWorker; num++) {
					if(childs[num].isPaused) break;
				}
				if(num === childsPerWorker) {
					self.postMessage({ 'type': "resumed" });
				}
			})(id, data);
			break;
		case "terminated":
			(function(id, data) {
				childs[id].isStarted = false;
				childs[id].isPaused = false;
				var num;
				for(num = 0; num < childsPerWorker; num++) {
					if(childs[num].isStarted) break;
				}
				if(num === childsPerWorker) {
					self.postMessage({ 'type': "terminated" });
				}
			})(id, data);
			break;
		}
	}
}