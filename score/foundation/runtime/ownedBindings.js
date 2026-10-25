export function createOwnedBindings() {
    const owned = [];
    return {
        mount(target, values) {
            for (const [key, value] of Object.entries(values)) {
                if (target[key] !== undefined) continue;
                target[key] = value;
                owned.push({target, key, value});
            }
        },
        clear() {
            for (const {target, key, value} of owned) if (target[key] === value) delete target[key];
            owned.length = 0;
        },
    };
}
