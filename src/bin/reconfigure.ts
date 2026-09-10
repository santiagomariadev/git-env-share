#!/usr/bin/env node
import { setup } from '../scripts/setup';

export async function runReconfigure() {
	await setup();
}

if (require.main === module) {
	void runReconfigure();
}
