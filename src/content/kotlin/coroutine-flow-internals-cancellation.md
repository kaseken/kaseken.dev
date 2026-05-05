---
title: "Understanding Kotlin Coroutines Flow Internals: The Cancellation Mechanism"
description: "A deep dive into how Flow cancellation works in Kotlin Coroutines, decoded from the kotlinx.coroutines source code."
pubDate: 2026-05-05
tags: ["kotlin", "android", "coroutines", "flow"]
---

> **Japanese version:** This article is also available in Japanese on [Zenn](https://zenn.dev/kaseken/articles/0562ffcc739c1d).

I have been decoding the internal implementation of Kotlin Coroutines Flow from its source code, aiming to demystify Flow for developers who use it as a black box.

In previous articles, I covered Flow Builders like `flow`, Terminal Operators like `collect`, and Intermediate Operators like `map`, `filter`, `flowOn`, and `buffer` — all from their internal implementations.

- [**Part 1. Understanding Kotlin Coroutines Flow Internals: Flow Builder, emit, and collect**](/kotlin/coroutine-flow-internals-basic/)
- [**Part 2. Understanding Kotlin Coroutines Flow Internals: How map and filter Work**](/kotlin/coroutine-flow-internals-intermediate-operator/)
- [**Part 3. Understanding Kotlin Coroutines Flow Internals: How flowOn Switches Execution Contexts**](/kotlin/coroutine-flow-internals-flowon/)
- [**Part 4. Understanding Kotlin Coroutines Flow Internals: Buffering and Conflation**](/kotlin/coroutine-flow-internals-buffer/)

So far, we have only looked at cases where processing completes normally. From here, we look at how Flow handles abnormal cases — specifically, "cancellation" and "exceptions." These are important topics in production code, yet the behavior can be difficult to predict. By understanding the internal implementation, we aim to be able to accurately picture what actually happens at runtime.

This article focuses on the former: cancellation. The next article will cover the latter: exception handling.

> **Note:** The version of `kotlinx.coroutines`[^1] used in this article is [v1.10.2](https://github.com/Kotlin/kotlinx.coroutines/releases/tag/1.10.2), the latest version at the time of writing.

[^1]: `Kotlin/kotlinx.coroutines`: https://github.com/Kotlin/kotlinx.coroutines

## Basic Specs of Flow's Cancellation Mechanism

Let's review the basic specs of Flow's cancellation mechanism from the official documentation[^2].

[^2]: Flow cancellation basics: https://kotlinlang.org/docs/flow.html#flow-cancellation-basics

The following code cancels a simple Flow that emits values every 1000ms using `withTimeoutOrNull`[^3] at the 2500ms mark.

[^3]: `withTimeoutOrNull`: https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/with-timeout-or-null.html

```kt
fun simple(): Flow<Int> = flow { 
    for (i in 1..3) {
        delay(1000)          
        println("Emitting $i")
        emit(i)
    }
}

fun main() = runBlocking<Unit> {
    val time = measureTimeMillis {
        withTimeoutOrNull(2500) { // Timeout after 2500ms 
            simple().collect { value -> println(value) } 
        }
    }   
    println("Cancelled in $time ms")
}
```
[▶️ **Run in Playground**](https://pl.kotl.in/Vekx1AD0F)

Looking at the output, we can see that after the second value is emitted, the Flow is cancelled during the `delay` before the third value is emitted.

**Output:**
```
Emitting 1
1
Emitting 2
2
Cancelled in 2565 ms
```

This is a very basic example, but let's look at how this cancellation behavior is achieved from the internal implementation.

## Internal Implementation of the Cancellation Mechanism

Let's look at what's happening under the hood in the sample code above.

### How `withTimeoutOrNull` Works

Although not part of Flow's implementation itself, let's first examine how `withTimeoutOrNull` works.

The implementation of `withTimeoutOrNull` is shown below.

```kt
public suspend fun <T> withTimeoutOrNull(timeMillis: Long, block: suspend CoroutineScope.() -> T): T? {
    if (timeMillis <= 0L) return null

    var coroutine: TimeoutCoroutine<T?, T?>? = null
    try {
        return suspendCoroutineUninterceptedOrReturn { uCont ->
            val timeoutCoroutine = TimeoutCoroutine(timeMillis, uCont)
            coroutine = timeoutCoroutine
            setupTimeout<T?, T?>(timeoutCoroutine, block)
        }
    } catch (e: TimeoutCancellationException) {
        // Return null if it's our exception, otherwise propagate it upstream (e.g. in case of nested withTimeouts)
        if (e.coroutine === coroutine) {
            return null
        }
        throw e
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/Timeout.kt#L97-L114)

A `TimeoutCoroutine` is created, and then `setupTimeout` is called with that `TimeoutCoroutine` and the lambda (`block`) passed to `withTimeoutOrNull`.

Looking at the implementation of `TimeoutCoroutine`, when its `run` method (a method of the `Runnable` interface) is called, the coroutine itself is cancelled.

```kt
private class TimeoutCoroutine<U, in T : U>(
    @JvmField val time: Long,
    uCont: Continuation<U> // unintercepted continuation
) : ScopeCoroutine<T>(uCont.context, uCont), Runnable {
    override fun run() {
        cancelCoroutine(TimeoutCancellationException(time, context.delay, this))
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/Timeout.kt#L152-L162)

The implementation of `setupTimeout` is shown below.

```kt
private fun <U, T : U> setupTimeout(
    coroutine: TimeoutCoroutine<U, T>,
    block: suspend CoroutineScope.() -> T
): Any? {
    // schedule cancellation of this coroutine on time
    val cont = coroutine.uCont
    val context = cont.context
    coroutine.disposeOnCompletion(context.delay.invokeOnTimeout(coroutine.time, coroutine, coroutine.context))
    // restart the block using a new coroutine with a new job,
    // however, start it undispatched, because we already are in the proper context
    return coroutine.startUndispatchedOrReturnIgnoreTimeout(coroutine, block)
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/Timeout.kt#L139-L150)

`setupTimeout` does three main things:

- First, it registers the cancellation logic to be executed on timeout with the scheduler. This is handled by `context.delay.invokeOnTimeout(coroutine.time, coroutine, coroutine.context)`. On timeout, the `run` method of `TimeoutCoroutine` described above will be called.
- Second, it ensures that the scheduled cancellation is disposed when the coroutine completes normally. This is handled by `coroutine.disposeOnCompletion`.
- Third, it launches the coroutine and executes the lambda (`block`) passed to `withTimeoutOrNull`. This is handled by `coroutine.startUndispatchedOrReturnIgnoreTimeout`.

In summary, `withTimeoutOrNull` launches a coroutine (`TimeoutCoroutine`), executes the passed lambda, and schedules the `TimeoutCoroutine` to be cancelled after the specified duration. Next, let's see how this `TimeoutCoroutine` cancellation propagates to Flow cancellation.

### How Flow Gets Cancelled

First, let's review the Flow execution flow uncovered in [**Part 1**](/kotlin/coroutine-flow-internals-basic/).

![Flow execution flow](/images/coroutine-flow-internals-cancellation/fcf6afd2eed8-20260502.png)
*Flow execution flow*

Flow executes in the following steps:

1. The Flow Builder (`flow` function) returns an instance of `SafeFlow`.
2. When `collect` is called on `SafeFlow`, the lambda passed to `flow` is invoked.
3. When `emit` is called inside the lambda passed to `flow`, the lambda passed to `collect` is called.

In the sample code above, let's verify which coroutines execute the `flow` lambda and `collect` lambda with the following code.

```kt
fun simple(): Flow<Int> = flow {
    val job = currentCoroutineContext()[Job]!!
    println("[flow lambda]    Job@${"%x".format(System.identityHashCode(job))} (${job::class.simpleName})")
    for (i in 1..3) {
        delay(1000)
        emit(i)
    }
}

fun main() = runBlocking<Unit> {
    val runBlockingJob = coroutineContext[Job]!!
    println("[runBlocking]    Job@${"%x".format(System.identityHashCode(runBlockingJob))} (${runBlockingJob::class.simpleName})")

    val time = measureTimeMillis {
        withTimeoutOrNull(2500) {
            val timeoutJob = coroutineContext[Job]!!
            println("[withTimeout]    Job@${"%x".format(System.identityHashCode(timeoutJob))} (${timeoutJob::class.simpleName})")
            println("[withTimeout]    child of runBlocking? ${runBlockingJob.children.contains(timeoutJob)}")

            simple().collect { value ->
                val collectJob = currentCoroutineContext()[Job]!!
                println("[collect lambda] Job@${"%x".format(System.identityHashCode(collectJob))}")
                println("[collect lambda] === timeoutJob? ${collectJob === timeoutJob}")
                println(value)
            }
        }
    }
    println("Cancelled in $time ms")
}
```
[▶️ **Run in Playground**](https://pl.kotl.in/sONrGQkZZ)

Looking at the output, we can see that both the `flow` lambda and the `collect` lambda run on the `TimeoutCoroutine` that `withTimeoutOrNull` creates. This means that when `TimeoutCoroutine` is cancelled, those lambdas are naturally cancelled as well.

**Output:**
```
[runBlocking]    Job@6aceb1a5 (BlockingCoroutine)
[withTimeout]    Job@1936f0f5 (TimeoutCoroutine)
[withTimeout]    child of runBlocking? true
[flow lambda]    Job@1936f0f5 (TimeoutCoroutine)
[collect lambda] Job@1936f0f5
[collect lambda] === timeoutJob? true
1
[collect lambda] Job@1936f0f5
[collect lambda] === timeoutJob? true
2
Cancelled in 2532 ms
```

However, cancellation of suspend functions is a cooperative mechanism — it is never forced like an interrupt. Even if a coroutine is already cancelled, the running code will not be suspended unless it calls `ensureActive` to throw a `CancellationException` or calls `yield` to yield the thread.

In this case, `delay`[^4] is a cancellable suspend function that is immediately interrupted on cancellation, which is why the Flow can be cancelled even mid-`delay`.

[^4]: `delay`: https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines/delay.html

> **Note:** For more details on cancellation behavior in Kotlin Coroutines, see the official documentation[^5].

[^5]: Cancellation: https://kotlinlang.org/docs/cancellation-and-timeouts.html

## Cancellation When There Is No `delay`

In the previous example, the Flow could be cancelled mid-execution because `delay` is a cancellable suspend function. What happens when there is no `delay`?

Let's run the following sample code to find out. The key difference from the earlier code is that the `delay` before `emit` has been removed, and the timeout has been shortened to 10ms.

```kt
fun simple(): Flow<Int> = flow { 
    for (i in 1..100) {       
        println("Emitting $i")
        emit(i)
    }
}

fun main() = runBlocking<Unit> {
    withTimeoutOrNull(10) { // Timeout after 10ms 
        simple().collect { value -> println(value) } 
    }
    println("Done")
}
```
[▶️ **Run in Playground**](https://pl.kotl.in/Rjxc_6jpB)

Looking at the output, we can see that even without `delay`, the `flow` lambda is cancelled mid-execution (the exact number of values emitted before cancellation varies per run).

**Output:**
```
Emitting 1
1
Emitting 2
2
...
Emitting 59
59
Emitting 60
Done
```

The reason the `flow` can still be cancelled mid-execution is that **`ensureActive` is called inside `emit`**.
When `emit` is called inside `flow`, `SafeCollector`'s `emit` is executed. Looking at the source code of `SafeCollector`'s `emit` (the JVM implementation below), we can confirm that `currentContext.ensureActive()` is indeed called.

```kt
private fun emit(uCont: Continuation<Unit>, value: T): Any? {
    val currentContext = uCont.context
    currentContext.ensureActive() // 👈 HERE
    // This check is triggered once per flow on a happy path.
    val previousContext = lastEmissionContext
    if (previousContext !== currentContext) {
        checkContext(currentContext, previousContext, value)
        lastEmissionContext = currentContext
    }
    completion_ = uCont
    val result = emitFun(collector as FlowCollector<Any?>, value, this as Continuation<Unit>)
    /*
     * If the callee hasn't suspended, that means that it won't (it's forbidden) call 'resumeWith` (-> `invokeSuspend`)
     * and we don't have to retain a strong reference to it to avoid memory leaks.
     */
    if (result != COROUTINE_SUSPENDED) {
        completion_ = null
    }
    return result
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/86738dca7dc9ac82249abc8206263fa0065ee631/kotlinx-coroutines-core/jvm/src/flow/internal/SafeCollector.kt#L103-L122)

## Cancellation When the Execution Context Is Switched

In the examples so far, Flow has run in a single execution context (coroutine). But what happens when the execution context is switched via `flowOn`? How does cancellation propagate in that case?

By running the following code, we can reveal the coroutine structure that executes the `flow` lambda and `collect` lambda. `printJobTree` is a helper function that prints the descendant structure of a given `Job` as a tree.

```kt
fun printJobTree(job: Job, indent: String = "", connector: String = "") {
    println("$connector@${"%x".format(System.identityHashCode(job))}[${job::class.simpleName}]")
    val children = job.children.toList()
    children.forEachIndexed { i, child ->
        val isLast = i == children.lastIndex
        printJobTree(
            child,
            indent = indent + if (isLast) "    " else "│   ",
            connector = indent + if (isLast) "└── " else "├── "
        )
    }
}

fun simple(): Flow<Int> = flow {
    val job = currentCoroutineContext()[Job]!!
    println("[flow lambda]    Job@${"%x".format(System.identityHashCode(job))} (${job::class.simpleName}) thread: ${Thread.currentThread().name}")
    for (i in 1..3) {
        delay(1000)
        emit(i)
    }
}

fun main() = runBlocking<Unit> {
    val runBlockingJob = coroutineContext[Job]!!
    println("[runBlocking]    Job@${"%x".format(System.identityHashCode(runBlockingJob))} (${runBlockingJob::class.simpleName}) thread: ${Thread.currentThread().name}")

    val time = measureTimeMillis {
        withTimeoutOrNull(2500) {
            val timeoutJob = coroutineContext[Job]!!
            println("[withTimeout]    Job@${"%x".format(System.identityHashCode(timeoutJob))} (${timeoutJob::class.simpleName}) thread: ${Thread.currentThread().name}")

            simple().flowOn(Dispatchers.IO).collect { value ->
                val collectJob = currentCoroutineContext()[Job]!!
                println("[collect lambda] Job@${"%x".format(System.identityHashCode(collectJob))} (${collectJob::class.simpleName}) thread: ${Thread.currentThread().name}")
                printJobTree(timeoutJob)
                println(value)
            }
        }
    }
    println("Cancelled in $time ms")
}
```
[▶️ **Run in Playground**](https://pl.kotl.in/gzkTVKd4L)

This produces the following output.

**Output:**
```
[runBlocking]    Job@6aceb1a5 (BlockingCoroutine) thread: main @coroutine#1
[withTimeout]    Job@1936f0f5 (TimeoutCoroutine) thread: main @coroutine#1
[flow lambda]    Job@1ca9258a (ProducerCoroutine) thread: DefaultDispatcher-worker-1 @coroutine#2
[collect lambda] Job@73ad2d6 (ScopeCoroutine) thread: main @coroutine#1
@1936f0f5[TimeoutCoroutine]
└── @73ad2d6[ScopeCoroutine]
    └── @1ca9258a[ProducerCoroutine]
1
[collect lambda] Job@73ad2d6 (ScopeCoroutine) thread: main @coroutine#1
@1936f0f5[TimeoutCoroutine]
└── @73ad2d6[ScopeCoroutine]
    └── @1ca9258a[ProducerCoroutine]
2
Cancelled in 2538 ms
```

The three key points are:
- A parent-child hierarchy of `TimeoutCoroutine` → `ScopeCoroutine` → `ProducerCoroutine` is formed.
- The `flow` lambda runs on `ProducerCoroutine` (`Dispatchers.IO`).
- The `collect` lambda runs on `ScopeCoroutine` (main thread).

These three points can be explained by what we learned in [**Part 3**](/kotlin/coroutine-flow-internals-flowon/).

First, `flowOn` creates a `ChannelFlow`. Inside `ChannelFlow`'s `collect`, child coroutines are created.

```kt
public abstract class ChannelFlow<T>(/** omitted */) : FusibleFlow<T> {
    public open fun produceImpl(scope: CoroutineScope): ReceiveChannel<T> =
        // 👇 Creates `ProducerCoroutine` from `ScopeCoroutine`.
        scope.produce(context, produceCapacity, onBufferOverflow, start = CoroutineStart.ATOMIC, block = collectToFun)

    override suspend fun collect(collector: FlowCollector<T>): Unit =
        // 👇 Creates `ScopeCoroutine` from `TimeoutCoroutine`.
        coroutineScope {
            collector.emitAll(produceImpl(this))
        }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/internal/ChannelFlow.kt#L117-L120)

First, `coroutineScope` creates a `ScopeCoroutine` from the `TimeoutCoroutine`. Then, inside `produceImpl`, a `ProducerCoroutine` is created from the `ScopeCoroutine`, and the `flow` lambda runs on this `ProducerCoroutine` (`Dispatchers.IO`). Values emitted upstream inside `flow` are received via a `Channel` by the downstream `ScopeCoroutine` (main thread), where the `collect` lambda is executed (this is what happens inside `emitAll`).

The key takeaway for understanding the cancellation mechanism is: although the execution contexts differ across phases, these coroutines form a parent-child hierarchy, so cancellation propagates to all of them.

## Cases Where Flow Is Not Cancelled

So far, we have seen cases where Flow is cancelled due to cancellable functions like `delay` and `emit`. However, there are also cases where Flow is not cancelled. One example is when creating a Flow with `IntRange.asFlow`.

Running the following code shows that even when `cancel` is explicitly called, the Flow runs to completion without being cancelled.

```kt
fun main() = runBlocking<Unit> {
    (1..5).asFlow().collect { value -> 
        if (value == 3) cancel()  
        println(value)
    } 
}
```
[▶️ Run in Playground](https://pl.kotl.in/jGxRBR6M-)

**Output:**
```
1
2
3
4
5
Exception in thread "main" kotlinx.coroutines.JobCancellationException: BlockingCoroutine was cancelled
 at kotlinx.coroutines.JobSupport.cancel (JobSupport.kt:1558) 
 at kotlinx.coroutines.CoroutineScopeKt.cancel (CoroutineScope.kt:287) 
 at kotlinx.coroutines.CoroutineScopeKt.cancel$default (CoroutineScope.kt:285) 
```

The reason can also be confirmed from the internal implementation. Here is the source code of `Iterable<T>.asFlow()`.

```kt
public fun <T> Iterable<T>.asFlow(): Flow<T> = flow {
    forEach { value ->
        emit(value)
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Builders.kt#L85-L89)

Confusingly, the `flow` function called inside `asFlow` is not the public `flow` function but rather an internal `unsafeFlow` function.

```kt
internal inline fun <T> unsafeFlow(@BuilderInference crossinline block: suspend FlowCollector<T>.() -> Unit): Flow<T> {
    return object : Flow<T> {
        override suspend fun collect(collector: FlowCollector<T>) {
            collector.block()
        }
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/internal/SafeCollector.common.kt#L104-L110)

Unlike the public `flow` function, `unsafeFlow` does not create a `SafeFlow`. Therefore, when `emit` is called inside `unsafeFlow`, it does not go through `SafeCollector`'s `emit` (where `ensureActive` is called, as [explained earlier](#cancellation-when-there-is-no-delay)), and instead calls the `collect` lambda directly. This is why the Flow keeps running even after the coroutine is already cancelled.

On the other hand, using `asFlow().cancellable()` makes the Flow cancellable mid-execution.

```kt
fun main() = runBlocking<Unit> {
    (1..5).asFlow().cancellable().collect { value -> 
        if (value == 3) cancel()  
        println(value)
    } 
}
```
[▶️ **Run in Playground**](https://pl.kotl.in/MqjimaQd9)

Output:
```
1
2
3
Exception in thread "main" kotlinx.coroutines.JobCancellationException: BlockingCoroutine was cancelled
 at kotlinx.coroutines.JobSupport.cancel (JobSupport.kt:1558) 
 at kotlinx.coroutines.CoroutineScopeKt.cancel (CoroutineScope.kt:287) 
 at kotlinx.coroutines.CoroutineScopeKt.cancel$default (CoroutineScope.kt:285) 
```

The implementation of `cancellable()` is straightforward.

```kt
public fun <T> Flow<T>.cancellable(): Flow<T> =
    when (this) {
        is CancellableFlow<*> -> this // Fast-path, already cancellable
        else -> CancellableFlowImpl(this)
    }

internal interface CancellableFlow<out T> : Flow<T>

private class CancellableFlowImpl<T>(private val flow: Flow<T>) : CancellableFlow<T> {
    override suspend fun collect(collector: FlowCollector<T>) {
        flow.collect {
            currentCoroutineContext().ensureActive()
            collector.emit(it)
        }
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/operators/Context.kt#L260-L281)

`cancellable()` wraps the original Flow in `CancellableFlowImpl`, a type of `Flow`. This acts as an intermediary during `emit` calls — when `emit` is called inside `unsafeFlow`, `currentCoroutineContext().ensureActive()` is called first, and only then is the downstream `collect` lambda invoked.

## Summary

In this article, we have revealed the cancellation mechanism of Flow from its internal implementation.

To summarize: by understanding the `collect` and `emit` call flow learned in [**Part 1**](/kotlin/coroutine-flow-internals-basic/), knowing at which points a suspend function becomes cancellable (i.e., where `ensureActive` or equivalent is called), and examining the parent-child coroutine structure when execution contexts are switched, we can naturally derive the cancellation behavior of Flow.
