// -----------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------
import { PARAMS_CONFIG } from "./mandala_tree.js";

export function crossover(dnaA, dnaB) {
    const childDNA = [];
    const pivot = Math.floor(Math.random() * dnaA.length);

    for (let i = 0; i < dnaA.length; i++) {
        if (i < pivot) {
            childDNA.push(dnaA[i]);
        } else {
            childDNA.push(dnaB[i]);
        }
    }
    return childDNA;
}

export function mutate(dna, rate = 0.10) {
    return dna.map(gene => {
        if (Math.random() < rate) {
            let nudge = (Math.random() - 0.5) * 0.3;
            return Math.min(Math.max(gene + nudge, 0), 1);
        }
        return gene;
    });
}


export function genotypeToParams(genes) {
    const params = {};
    const keys = Object.keys(PARAMS_CONFIG);

    keys.forEach((key, i) => {
        const gene = genes[i];
        const config = PARAMS_CONFIG[key];

        if (config.options) {
            const index = Math.floor(gene * config.options.length);
            params[key] = config.options[Math.min(index, config.options.length - 1)];
        } else if (config.type === 'boolean') {
            params[key] = gene > 0.5;
        } else {
            params[key] = config.min + (config.max - config.min) * gene;
            if (config.step) {
                const inv = 1.0 / config.step;
                params[key] = Math.round(params[key] * inv) / inv;
            }
        }
    });
    return params;
}