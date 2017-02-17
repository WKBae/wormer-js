"use strict"

// TODO move these to setup
const wormsPerWorker = 2;
const childsPerWorker = 2;

var isParent;
var childs;
var simulation;
var wormCount;

var progress;
var doneGenes;
var doneFitness;

onmessage = function(e) {
	var data = e.data;
	if(data.type === "setup") {
		var count = data.count;
		var options = data.options;
		if(count > wormsPerWorker) {
			isParent = true;

			progress = [0, 0];
			doneGenes = [];
			doneFitness = [];

			var prevCount = 0;
			if(childs && childs.length > 0) {
				prevCount = childs.length;
				for(var i = 0; i < prevCount; i++) {
					childs[i].count = ((count/childsPerWorker)|0) + (count%childsPerWorker > i? 1 : 0);
					childs[i].isSetUp = false;
					childs[i].worker.postMessage({ 'type': "setup", 'count': childs[i].count, 'options': options });
				}
			} else {
				childs = [];
			}
			for(var i = prevCount; i < childsPerWorker; i++) {
				childs[i] = {
					'worker': new Worker('wormer-nested-worker.js'),
					'isSetUp': false,
					'count': ((count/childsPerWorker)|0) + (count%childsPerWorker > i? 1 : 0)
				};
				childs[i].worker.onmessage = childMessage(i);
				childs[i].worker.postMessage({ 'type': "setup", 'count': childs[i].count, 'options': options });
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

			self.postMessage({ 'type': "setupDone" });
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
		case "pause":
		case "terminate":
			childs.forEach(function(child) {
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
		case "terminate":
			simulation.terminate();
			// self.stop();
			break;
		}
	}
}

function setupSimulation() {
	const reportRate = 0.1; // every 10%
	var duration = simulation.options.simulation.duration;
	var step = simulation.options.simulation.timestep;
	var ticks = Math.floor((duration / step) * reportRate);
	var current = 0;

	simulation.on('generationStart', function() {
		current = 0;
		self.postMessage({ 'type': "progress", 'progress': 0 });
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
		self.postMessage({ 'type': "generationEnd", 'genes': genes, 'fitness': fitness, 'average': average });
		this.pause();
	});
}

var lastProgress = 0;
function childMessage(id) {
	return function(e) {
		var data = e.data;
		var type = data.type;
		switch(type) {
		case "setupDone":
			childs[id].isSetUp = true;
			var num;
			for(num = 0; num < childsPerWorker; num++) {
				if(!childs[num].isSetUp) break;
			}
			if(num === childsPerWorker) {
				self.postMessage({ 'type': "setupDone" });
			}
			break;
		case "progress":
			progress[id] = data.progress;
			var totalProgress = 0;
			for(var i = 0; i < childsPerWorker; i++) {
				totalProgress += progress[i];
			}
			var avgProgress = totalProgress / childsPerWorker;
			if(Math.abs(lastProgress - avgProgress) >= 0.05) {
				self.postMessage({ 'type': "progress", 'progress': avgProgress });
				lastProgress = avgProgress;
			}
			break;
		case "generationEnd":
			doneGenes.push(data.genes);
			doneFitness.push(data.fitness);
			// TODO use childsPerWorker, instead of fixed value(2)
			if(doneGenes.length >= 2) {
				/* Merge sort, genes and fitnesses are posted sorted */
				var total = doneGenes[0].length + doneGenes[1].length;
				var fitnessSum = 0;
				var i0 = 0, i1 = 0;
				var resGenes = [];
				var resFitness = [];
				for(var count = 0; count < total; count++) {
					if(i1 >= doneGenes[1].length || doneFitness[0][i0] >= doneFitness[1][i1]) {
						resGenes[count] = doneGenes[0][i0];
						resFitness[count] = doneFitness[0][i0];
						i0++;
					} else {
						resGenes[count] = doneGenes[1][i1];
						resFitness[count] = doneFitness[1][i1];
						i1++;
					}
					fitnessSum += resFitness[count];
				}
				self.postMessage({ 'type': "generationEnd", 'genes': resGenes, 'fitness': resFitness, 'average': fitnessSum / total });
				doneGenes = [];
				doneFitness = [];
			}
			break;

		}
	}
}