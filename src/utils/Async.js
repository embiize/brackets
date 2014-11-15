/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */


/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, window, Promise */

/**
 * Utilities for working with Promises and other asynchronous processes.
 */
define(function (require, exports, module) {
    "use strict";
    
    // Further ideas for Async utilities...
    //  - Utilities for blocking UI until a Promise completes?
    //  - A "SuperPromise" could feature some very useful enhancements:
    //     - API for cancellation (non guaranteed, best attempt)
    //     - Easier way to add a timeout clause (withTimeout() wrapper below is more verbose)
    //     - Encapsulate the task kickoff code so you can start it later, e.g. superPromise.start()
    //  - Promises are unable to do anything akin to a 'finally' block. It'd be nice if we
    //    could harvest exceptions across all steps of an async process and pipe them to a handler,
    //    so that we don't leave UI-blocking overlays up forever, etc. But this is hard: we'd have
    //    wrap every async callback (including low-level native ones that don't use [Super]Promise)
    //    to catch exceptions, and then understand which Promise(s) the code *would* have resolved/
    //    rejected had it run to completion.
    

    /**
     * Executes a series of tasks in parallel, returning a "master" Promise that is resolved once
     * all the tasks have resolved. If one or more tasks fail, behavior depends on the failFast
     * flag:
     *   - If true, the master Promise is rejected as soon as the first task fails. The remaining
     *     tasks continue to completion in the background.
     *   - If false, the master Promise is rejected after all tasks have completed.
     *
     * If nothing fails:          (M = master promise; 1-4 = tasks; d = done; F = fail)
     *  M  ------------d
     *  1 >---d        .
     *  2 >------d     .
     *  3 >---------d  .
     *  4 >------------d
     *
     * With failFast = false:
     *  M  ------------F
     *  1 >---d     .  .
     *  2 >------d  .  .
     *  3 >---------F  .
     *  4 >------------d
     *
     * With failFast = true: -- similar to Promise.race()
     *  M  ---------F
     *  1 >---d     .
     *  2 >------d  .
     *  3 >---------F
     *  4 >------------d   (#4 continues even though master Promise has failed)
     * (Note: if tasks finish synchronously, the behavior is more like failFast=false because you
     * won't get a chance to respond to the master Promise until after all items have been processed)
     *
     * To perform task-specific work after an individual task completes, attach handlers to each
     * Promise before beginProcessItem() returns it.
     *
     * Note: don't use this if individual tasks (or their done/fail handlers) could ever show a user-
     * visible dialog: because they run in parallel, you could show multiple dialogs atop each other.
     *
     * @param {!Array.<*>} items
     * @param {!function(*, number):Promise} beginProcessItem
     * @param {!boolean} failFast
     * @return {Promise}
     */
    function doInParallel(items, beginProcessItem, failFast) {
        var promises = [];

        return new Promise(function (resolve, reject) {
            if (items.length === 0) {
                resolve();

            } else {
                var numCompleted = 0;
                var hasFailed = false;

                items.forEach(function (item, i) {
                    // Convert to Promise
                    var itemPromise = Promise.resolve(beginProcessItem(item, i));
                    promises.push(itemPromise);

                    itemPromise.catch(function () {
                        if (failFast) {
                            reject();
                        } else {
                            hasFailed = true;
                        }
                    });
                    var fnAlways = function () {
                        numCompleted++;
                        if (numCompleted === items.length) {
                            if (hasFailed) {
                                reject();
                            } else {
                                resolve();
                            }
                        }
                    };
                    itemPromise.then(fnAlways, fnAlways);
                });
            }
        });
    }
    
    /**
     * Executes a series of tasks in serial (task N does not begin until task N-1 has completed).
     * Returns a "master" Promise that is resolved once all the tasks have resolved. If one or more
     * tasks fail, behavior depends on the failAndStopFast flag:
     *   - If true, the master Promise is rejected as soon as the first task fails. The remaining
     *     tasks are never started (the serial sequence is stopped).
     *   - If false, the master Promise is rejected after all tasks have completed.
     *
     * If nothing fails:
     *  M  ------------d
     *  1 >---d        .
     *  2     >--d     .
     *  3        >--d  .
     *  4           >--d
     *
     * With failAndStopFast = false:
     *  M  ------------F
     *  1 >---d     .  .
     *  2     >--d  .  .
     *  3        >--F  .
     *  4           >--d
     *
     * With failAndStopFast = true:
     *  M  ---------F
     *  1 >---d     .
     *  2     >--d  .
     *  3        >--F
     *  4          (#4 never runs)
     *
     * To perform task-specific work after an individual task completes, attach handlers to each
     * Promise before beginProcessItem() returns it.
     * 
     * @param {!Array.<*>} items
     * @param {!function(*, number):Promise} beginProcessItem
     * @param {!boolean} failAndStopFast
     * @return {Promise}
     */
    function doSequentially(items, beginProcessItem, failAndStopFast) {

        return new Promise(function (resolve, reject) {
            var hasFailed = false;

            function doItem(i) {
                if (i >= items.length) {
                    if (hasFailed) {
                        reject();
                    } else {
                        resolve();
                    }
                    return;
                }

                // Convert to Promise
                var itemPromise = Promise.resolve(beginProcessItem(items[i], i));

                itemPromise.then(function () {
                    doItem(i + 1);
                });
                itemPromise.catch(function () {
                    if (failAndStopFast) {
                        reject();
                        // note: we do NOT process any further items in this case
                    } else {
                        hasFailed = true;
                        doItem(i + 1);
                    }
                });
            }

            doItem(0);
        });
    }
    
    /**
     * Executes a series of synchronous tasks sequentially spread over time-slices less than maxBlockingTime.
     * Processing yields by idleTime between time-slices.
     * 
     * @param {!Array.<*>} items
     * @param {!function(*, number)} fnProcessItem  Function that synchronously processes one item
     * @param {number=} maxBlockingTime
     * @param {number=} idleTime
     * @return {Promise}
     */
    function doSequentiallyInBackground(items, fnProcessItem, maxBlockingTime, idleTime) {
        
        maxBlockingTime = maxBlockingTime || 15;
        idleTime = idleTime || 30;
        
        var sliceStartTime = (new Date()).getTime();
        
        return doSequentially(items, function (item, i) {

            return new Promise(function (resolve, reject) {

                // process the next item
                fnProcessItem(item, i);

                // if we've exhausted our maxBlockingTime
                if ((new Date()).getTime() - sliceStartTime >= maxBlockingTime) {
                    //yield
                    window.setTimeout(function () {
                        sliceStartTime = (new Date()).getTime();
                        resolve();
                    }, idleTime);
                } else {
                    //continue processing
                    resolve();
                }
            });

        }, false);
    }
    
    /**
     * Executes a series of tasks in serial (task N does not begin until task N-1 has completed).
     * Returns a "master" Promise that is resolved when the first task has resolved. If all tasks
     * fail, the master Promise is rejected.
     *
     * @param {!Array.<*>} items
     * @param {!function(*, number):Promise} beginProcessItem
     * @return {Promise}
     */
    function firstSequentially(items, beginProcessItem) {

        return new Promise(function (resolve, reject) {
            function doItem(i) {
                if (i >= items.length) {
                    reject();
                    return;
                }

                beginProcessItem(items[i], i)
                    .catch(function () {
                        doItem(i + 1);
                    })
                    .then(function () {
                        resolve(items[i]);
                    });
            }

            doItem(0);
        });
    }
    
    /**
     * Executes a series of tasks in parallel, saving up error info from any that fail along the way.
     * Returns a Promise that is only resolved/rejected once all tasks are complete. This is
     * essentially a wrapper around doInParallel(..., false).
     *
     * If one or more tasks failed, the entire "master" promise is rejected at the end - with one
     * argument: an array objects, one per failed task. Each error object contains:
     *  - item -- the entry in items whose task failed
     *  - error -- the first argument passed to the fail() handler when the task failed
     *
     * @param {!Array.<*>} items
     * @param {!function(*, number):Promise} beginProcessItem
     * @return {Promise}
     */
    function doInParallel_aggregateErrors(items, beginProcessItem) {
        var errors = [];
        
        return new Promise(function (resolve, reject) {

            var parallelResult = doInParallel(
                items,
                function (item, i) {
                    // Convert to Promise
                    var itemResult = Promise.resolve(beginProcessItem(item, i));
                    itemResult.catch(function (error) {
                        errors.push({ item: item, error: error });
                    });
                    return itemResult;
                },
                false
            );

            parallelResult
                .then(function () {
                    resolve();
                })
                .catch(function () {
                    reject(errors);
                });
        });
    }
        
    /** Value passed to catch() handlers that have been triggered due to withTimeout()'s timeout */
    var ERROR_TIMEOUT = {};
    
    /**
     * Adds timeout-driven termination to a Promise: returns a new Promise that is resolved/rejected when
     * the given original Promise is resolved/rejected, OR is resolved/rejected after the given delay -
     * whichever happens first.
     * 
     * If the original Promise is resolved/rejected first, done()/fail() handlers receive arguments
     * piped from the original Promise. If the timeout occurs first instead, then resolve() or
     * fail() (with Async.ERROR_TIMEOUT) is called based on value of resolveTimeout.
     * 
     * @param {Promise} promise
     * @param {number} timeout
     * @param {boolean=} resolveTimeout If true, then resolve Promise on timeout, otherwise reject. Default is false.
     * @return {Promise}
     */
    function withTimeout(promise, timeout, resolveTimeout) {

        return new Promise(function (resolve, reject) {

            var timer = window.setTimeout(function () {
                if (resolveTimeout) {
                    resolve();
                } else {
                    reject(ERROR_TIMEOUT);
                }
            }, timeout);

            var fnAlways = function () {
                window.clearTimeout(timer);
            };
            promise.then(fnAlways, fnAlways);

            // If the wrapper was already rejected due to timeout, the Promise's calls to resolve/reject
            // won't do anything
            promise.then(resolve, reject);
        });
    }
    
    /**
     * Allows waiting for all the promises to be either resolved or rejected.
     * Unlike $.when(), it does not call .catch() or .then() handlers on first
     * reject. The caller should take all the precaution to make sure all the
     * promises passed to this function are completed to avoid blocking.
     * 
     * If failOnReject is set to true, promise returned by the function will be
     * rejected if at least one of the promises was rejected. The default value
     * is false, which will cause the call to this function to be always
     * successfully resolved.
     * 
     * If timeout is specified, the promise will be rejected on timeout as per
     * Async.withTimeout.
     * 
     * @param {!Array.<Promise>} promises Array of promises to wait for
     * @param {boolean=} failOnReject  Whether to reject or not if one of the promises has been rejected.
     * @param {number=} timeout        Number of milliseconds to wait until rejecting the promise
     * 
     * @return {Promise} Promise which will be completed once all the other Promises complete
     * 
     */
    function waitForAll(promises, failOnReject, timeout) {

        return new Promise(function (resolve, reject) {
            var results = [],
                count = 0,
                sawRejects = false;

            if (!promises || promises.length === 0) {
                resolve();
                return;
            }

            // set defaults if needed
            failOnReject = !!failOnReject;

            if (timeout !== undefined) {
                withTimeout(this, timeout);
            }

            promises.forEach(function (p) {
                // This is a public API, so this could be a jQuery promise
                var promise = Promise.resolve(p);
                promise.catch(function (err) {
                    sawRejects = true;
                }).then(function (result) {
                    results.push(result);
                });

                var fnAlways = function () {
                    count++;
                    if (count === promises.length) {
                        if (failOnReject && sawRejects) {
                            reject();
                        } else {
                            resolve(results);
                        }
                    }
                };
                promise.then(fnAlways, fnAlways);
            });
        });
    }
    
    /**
     * Chains a series of synchronous and asynchronous (jQuery promise-returning) functions
     * together, using the result of each successive function as the argument(s) to the next.
     * A promise is returned that resolves with the result of the final call if all calls
     * resolve or return normally. Otherwise, if any of the functions reject or throw, the
     * computation is halted immediately and the promise is rejected with this halting error.
     *
     * @param {Array.<function(*)>} functions Functions to be chained
     * @param {?Array} args Arguments to call the first function with
     * @return {Promise} A promise that resolves with the result of the final call, or
     * rejects with the first error.
     */
    function chain(functions, args) {

        return new Promise(function (resolve, reject) {

            function chainHelper(index, args) {
                if (functions.length === index) {
                    resolve(args);
                } else {
                    var nextFunction = functions[index++],
                        responseOrPromise = nextFunction.apply(null, args);
                    if (responseOrPromise.hasOwnProperty("then") &&
                            responseOrPromise.hasOwnProperty("catch")) {
                        responseOrPromise.then(function () {
                            chainHelper(index, arguments);
                        });
                        responseOrPromise.catch(function () {
                            reject(arguments);
                        });
                    } else {
                        chainHelper(index, [responseOrPromise]);
                    }
                }
            }

            chainHelper(0, args || []);
        });
    }
    
    /**
     * Utility for converting a method that takes (error, callback) to one that returns a promise;
     * useful for using FileSystem methods (or other Node-style API methods) in a promise-oriented
     * workflow. For example, instead of
     *
     *      return new Promise(function (resolve, reject) {
     *          file.read(function (err, contents) {
     *              if (err) {
     *                  reject(err);
     *              } else {
     *                  // ...process the contents...
     *                  resolve();
     *              }
     *          }
     *      });
     *
     * you can just do
     *
     *      return Async.promisify(file, "read").then(function (contents) {
     *          // ...process the contents...
     *      });
     *
     * The object/method are passed as an object/string pair so that we can
     * properly call the method without the caller having to deal with "bind" all the time.
     *
     * @param {Object} obj The object to call the method on.
     * @param {string} method The name of the method. The method should expect the errback
     *      as its last parameter.
     * @param {...Object} varargs The arguments you would have normally passed to the method
     *      (excluding the errback itself).
     * @return {Promise} A promise that is resolved with the arguments that were passed to the
     *      errback (not including the err argument) if err is null, or rejected with the err if
     *      non-null.
     */
    function promisify(obj, method) {
        var args = Array.prototype.slice.call(arguments, 2);

        return new Promise(function (resolve, reject) {
            args.push(function (err) {
                if (err) {
                    reject(err);
                } else {
                    resolve.apply(this, Array.prototype.slice.call(arguments, 1));
                }
            });
            obj[method].apply(obj, args);
        });
    }

    /**
     * Creates a queue of async operations that will be executed sequentially. Operations can be added to the
     * queue at any time. If the queue is empty and nothing is currently executing when an operation is added, 
     * it will execute immediately. Otherwise, it will execute when the last operation currently in the queue 
     * has finished.
     * @constructor
     */
    function PromiseQueue() {
        this._queue = [];
    }
    
    /**
     * @private
     * @type {Array.<function(): Promise>}
     * The queue of operations to execute sequentially. Note that even if this array is empty, there might
     * still be an operation we need to wait on; that operation's promise is stored in _curPromise.
     */
    PromiseQueue.prototype._queue = null;
    
    /**
     * @private
     * @type {Promise}
     * The promise we're currently waiting on, or null if there's nothing currently executing.
     */
    PromiseQueue.prototype._curPromise = null;
    
    /**
     * @type {number} The number of queued promises.
     */
    Object.defineProperties(PromiseQueue.prototype, {
        "length": {
            get: function () { return this._queue.length; },
            set: function () { throw new Error("Cannot set length"); }
        }
    });
    
    /**
     * Adds an operation to the queue. If nothing is currently executing, it will execute immediately (and
     * the next operation added to the queue will wait for it to complete). Otherwise, it will wait until
     * the last operation in the queue (or the currently executing operation if nothing is in the queue) is
     * finished. The operation must return a promise that will be resolved or rejected when it's finished;
     * the queue will continue with the next operation regardless of whether the current operation's promise
     * is resolved or rejected.
     * @param {function(): Promise} op The operation to add to the queue.
     */
    PromiseQueue.prototype.add = function (op) {
        this._queue.push(op);

        // If something is currently executing, then _doNext() will get called when it's done. If nothing
        // is executing (in which case the queue should have been empty), we need to call _doNext() to kickstart
        // the queue.
        if (!this._curPromise) {
            this._doNext();
        }
    };
    
    /**
     * Removes all pending promises from the queue.
     */
    PromiseQueue.prototype.removeAll = function () {
        this._queue = [];
    };
    
    /**
     * @private
     * Pulls the next operation off the queue and executes it.
     */
    PromiseQueue.prototype._doNext = function () {
        var self = this;
        if (this._queue.length) {
            var op = this._queue.shift();
            this._curPromise = op();
            var fnAlways = function () {
                self._curPromise = null;
                self._doNext();
            };
            this._curPromise.then(fnAlways, fnAlways);
        }
    };
    
    /**
     * Helper function to ease converting from jQuery Deferreds to ES6 Promises.
     * 
     * @param {!Promise} promise
     * @param {!function()} fn Function to always be executed
     * @return {Promise} For chaining
     */
    function promiseAlways(promise, fn) {
        promise.then(fn, fn);
        return promise;
    }
    
    // Define public API
    exports.doInParallel        = doInParallel;
    exports.doSequentially      = doSequentially;
    exports.doSequentiallyInBackground   = doSequentiallyInBackground;
    exports.doInParallel_aggregateErrors = doInParallel_aggregateErrors;
    exports.firstSequentially   = firstSequentially;
    exports.withTimeout         = withTimeout;
    exports.waitForAll          = waitForAll;
    exports.ERROR_TIMEOUT       = ERROR_TIMEOUT;
    exports.chain               = chain;
    exports.promisify           = promisify;
    exports.PromiseQueue        = PromiseQueue;
    exports.promiseAlways       = promiseAlways;
});
