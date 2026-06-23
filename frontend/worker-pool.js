// -----------------------------------------------------------
// WORKER POOL - Manages multiple workers for parallel generation
// -----------------------------------------------------------
let auxWorkers = 5;

const workersSlider = document.getElementById('workers');
if (workersSlider) {
    workersSlider.value = auxWorkers || 5;
    workersSlider.oninput = function () {
        console.log(workersSlider.value);
        auxWorkers = workersSlider.value;
    }
}

export class WorkerPool {
    constructor(workerScript = 'geometry-worker.js') {
        //const numCores = navigator.hardwareConcurrency / 2 || 4;
        const numCores = auxWorkers || 5;
        //const numCores = 1;
        console.log(numCores);
        this.numWorkers = Math.max(2, numCores - 1); // Leave 1 core for main thread
        this.workerScript = workerScript;
        this.workers = [];
        this.taskQueue = [];
        this.activeWorkers = new Map();
        this.nextWorkerIndex = 0;

        this.initializeWorkers();
        console.log(`WorkerPool initialized: ${this.numWorkers} workers (${numCores} CPU cores detected)`);
    }

    //Initialize worker pool and load font for them
    initializeWorkers() {
        for (let i = 0; i < this.numWorkers; i++) {
            const worker = new Worker(this.workerScript, { type: 'module' });
            this.workers.push(worker);
        }
    }


    // // Generate a batch of objects using worker pool
    // // Distributes objects evenly across available workers
    // async generateBatch(population, lod = 'low') {
    //     const objectsPerWorker = Math.ceil(population.length / this.numWorkers);
    //     const promises = [];

    //     for (let i = 0; i < this.numWorkers; i++) {
    //         const start = i * objectsPerWorker;
    //         const end = Math.min(start + objectsPerWorker, population.length);

    //         if (start >= population.length) break;

    //         const chunk = population.slice(start, end);
    //         promises.push(this.processWorker(this.workers[i], chunk, lod));
    //     }

    //     const results = await Promise.all(promises);
    //     return results.flatMap(r => r).sort((a, b) => a.id - b.id);
    // }


    // // Process a chunk of objects with a single worker
    // processWorker(worker, chunk, lod) {
    //     return new Promise((resolve, reject) => {
    //         const messageHandler = (e) => {
    //             if (e.data.type !== 'BATCH') return;

    //             worker.removeEventListener('message', messageHandler);
    //             worker.removeEventListener('error', errorHandler);

    //             if (e.data.success) {
    //                 resolve(e.data.results);
    //             } else {
    //                 reject(new Error(e.data.error || 'Unknown worker error'));
    //             }
    //         };

    //         const errorHandler = (error) => {
    //             worker.removeEventListener('message', messageHandler);
    //             worker.removeEventListener('error', errorHandler);
    //             reject(error);
    //         };

    //         worker.addEventListener('message', messageHandler);
    //         worker.addEventListener('error', errorHandler);

    //         worker.postMessage({
    //             type: 'GENERATE_BATCH',
    //             population: chunk,
    //             lod: lod
    //         });
    //     });
    // }

    async generateSingle(params, fontShapeData = null, lod = 'high', id = null) {
        const workerIndex = this.nextWorkerIndex;
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.numWorkers;
        const worker = this.workers[workerIndex];

        return new Promise((resolve, reject) => {
            const messageHandler = (e) => {
                if (e.data.type !== 'SINGLE' || e.data.id !== id) return;
                worker.removeEventListener('message', messageHandler);
                worker.removeEventListener('error', errorHandler);

                if (e.data.success) {
                    resolve(e.data);
                } else {
                    reject(new Error(e.data.error || 'Unknown worker error'));
                }
            };

            const errorHandler = (error) => {
                worker.removeEventListener('message', messageHandler);
                worker.removeEventListener('error', errorHandler);
                reject(error);
            };

            worker.addEventListener('message', messageHandler);
            worker.addEventListener('error', errorHandler);

            worker.postMessage({
                type: 'GENERATE_SINGLE',
                params: params,
                fontShapeData: fontShapeData,
                lod: lod,
                id: id
            });
        });
    }

    //Terminate all workers
    terminate() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
        console.log('✓ All workers terminated');
    }

    //Get worker pool stats
    getStats() {
        return {
            numWorkers: this.numWorkers,
            availableCores: navigator.hardwareConcurrency || 'unknown',
            workersActive: this.activeWorkers.size
        };
    }
}