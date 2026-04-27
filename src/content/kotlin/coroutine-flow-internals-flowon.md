---
title: "Understanding Kotlin Coroutines Flow Internals: How flowOn Switches Execution Contexts"
description: "A deep dive into the internal implementation of flowOn in Kotlin Coroutines Flow, explaining how it switches execution contexts under the hood."
pubDate: 2026-04-27
tags: ["kotlin", "android", "coroutines", "kotlin-coroutines-flow"]
---

> **Japanese version:** This article is also available in Japanese on [Zenn](https://zenn.dev/kaseken/articles/fe322949a6f0fc).

I have been decoding the internal implementation of Kotlin Coroutines Flow from its source code, aiming to demystify Flow for developers who use it as a black box.
In previous articles, I covered Flow Builders like `flow`, Terminal Operators like `collect`, and basic Intermediate Operators like `map` and `filter`.

- [Understanding Kotlin Coroutines Flow Internals: Flow Builder, emit, and collect](/kotlin/coroutine-flow-internals-basic/)
- [Understanding Kotlin Coroutines Flow Internals: How map and filter Work](/kotlin/coroutine-flow-internals-intermediate-operator/)

In this article, I take on `flowOn` — a more advanced Intermediate Operator — and decode how it switches execution contexts from the inside.
When using Flow, you often need to switch contexts: running IO-bound work on a background thread, or updating UI on the main thread. At the same time, `flowOn` has behaviors that seem counterintuitive at first glance, such as "flowOn only affects the upstream context." Rather than just memorizing these rules, the goal of this article is to help you understand the underlying mechanics and use `flowOn` with confidence.

> **Note:** The version of `kotlinx.coroutines`[^1] used in this article is [v1.10.2](https://github.com/Kotlin/kotlinx.coroutines/releases/tag/1.10.2), the latest version at the time of writing.

[^1]: `Kotlin/kotlinx.coroutines`: https://github.com/Kotlin/kotlinx.coroutines

## Review of flowOn's Surface-Level Specs

First, let's recap the execution context rules for Flow, based on the official documentation.

### ① Context Preservation

The lambda passed to `collect` **runs in the caller's context**. This property is called **Context Preservation**. The following sample code demonstrates this.

```kt
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

fun log(msg: String) = println("[${Thread.currentThread().name}] $msg")

fun simple(): Flow<Int> = flow {
    log("Started simple flow")
    for (i in 1..3) {
        emit(i)
    }
}  

fun main() = runBlocking<Unit> {
    // Runs on Main Thread.
    simple().collect { value -> log("Collected $value") } 

    // Runs on Background Thread.
    withContext(Dispatchers.IO) {
        simple().collect { value -> log("Collected $value") } 
    }
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/1ICBb8rS-)

```sh
[main @coroutine#1] Started simple flow
[main @coroutine#1] Collected 1
[main @coroutine#1] Collected 2
[main @coroutine#1] Collected 3
[DefaultDispatcher-worker-1 @coroutine#1] Started simple flow
[DefaultDispatcher-worker-1 @coroutine#1] Collected 1
[DefaultDispatcher-worker-1 @coroutine#1] Collected 2
[DefaultDispatcher-worker-1 @coroutine#1] Collected 3
```

### ② Emitting from a different context inside flow causes a runtime error

Consider a case where you want to run a heavy IO-bound operation on a background thread inside `flow`.

```kt
fun simple(): Flow<Int> = flow {
    val data = someHeavyJob() // We want to execute this on the background thread!
    emit(data)
}

fun main() = runBlocking<Unit> {
    simple().collect { value -> log("Collected $value") } 
}
```

If you try to call `emit` from a different context like this, a runtime error will occur.

```kt
fun simple(): Flow<Int> = flow {
    withContext(Dispatchers.IO) {
        val data = someHeavyJob() // We want to execute this on the background thread!
        emit(data) // ❌ emit is called from a different context.
    }
}  

fun main() = runBlocking<Unit> {
    simple().collect { value -> log("Collected $value") } 
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/19vngG_EC)

**Runtime error:**
```sh
[DefaultDispatcher-worker-1 @coroutine#1] someHeavyJob called.
Exception in thread "main" java.lang.IllegalStateException: Flow invariant is violated:
		Flow was collected in [CoroutineId(1), "coroutine#1":BlockingCoroutine{Active}@ba7ac3, BlockingEventLoop@3d4c3395],
		but emission happened in [CoroutineId(1), "coroutine#1":DispatchedCoroutine{Active}@28340b3c, Dispatchers.IO].
		Please refer to 'flow' documentation or use 'flowOn' instead
 at kotlinx.coroutines.flow.internal.SafeCollector_commonKt.checkContext (SafeCollector.common.kt:86) 
 at kotlinx.coroutines.flow.internal.SafeCollector.checkContext (SafeCollector.kt:106) 
 at kotlinx.coroutines.flow.internal.SafeCollector.emit (SafeCollector.kt:83) 
```

This is the mechanism that enforces **Context Preservation**.
As explained in the previous article, when `emit` is called, the lambda passed to `collect` is executed. So if `emit` is called from a different context, Context Preservation (i.e., the guarantee that the `collect` lambda always runs in the caller's context) would be violated.

The following works fine because `emit` is still called from the original context. Another option is to use `flowOn`, as explained next.

```kt
fun simple(): Flow<Int> = flow {
    val data = withContext(Dispatchers.IO) {
        someHeavyJob() // We want to execute this on the background thread!
    }
    emit(data) // ⭕️ emit is called from the same context.
}  

fun main() = runBlocking<Unit> {
    simple().collect { value -> log("Collected $value") } 
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/O1O92m4c-)

### ③ `flowOn` switches the upstream execution context

The standard way to switch execution contexts in a Flow is to use `flowOn`, an Intermediate Operator. By inserting `.flowOn(CoroutineContext)`, you can specify the context for everything **upstream** of that point.

```kt
fun simple(): Flow<Int> = flow {
    val data = someHeavyJob() // We want to execute this on the background thread!
    emit(data) // ⭕️ emit is always called from Dispatchers.IO
}

fun main() = runBlocking<Unit> {
    simple()
        .flowOn(Dispatchers.IO)
        .collect { value -> log("Collected $value") } 
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/bvCHaDIY-)

**Output:**
```
[DefaultDispatcher-worker-1 @coroutine#2] someHeavyJob called.
[main @coroutine#1] Collected 1
```

When a second `flowOn` is used further downstream, the context specified by the first `flowOn` is not overwritten.

```kt
fun simple(): Flow<Int> = flow {
    val data = someHeavyJob()
    emit(data)
}

fun main() = runBlocking<Unit> {
    simple() // Dispatchers.IO (⚠️ Is not overwritten by the second `flowOn`)
    	.flowOn(Dispatchers.IO)
        .map { // Dispatchers.Default
            log("map called.")
            it * 2
        }
        .flowOn(Dispatchers.Default)
        .collect { value -> log("Collected $value") }
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/5UcbdkSt8)

**Output:**
```
[DefaultDispatcher-worker-2 @coroutine#3] [dispatcher: Dispatchers.IO] someHeavyJob called.
[DefaultDispatcher-worker-2 @coroutine#2] [dispatcher: Dispatchers.Default] map called.
[main @coroutine#1] [dispatcher: BlockingEventLoop@6be46e8f] Collected 2
```

## Internal Implementation of `flowOn`

Now let's uncover the internal implementation behind the three behaviors described above. The following code is used as a running example.

```kt
suspend fun log(msg: String) {
    val dispatcher = currentCoroutineContext()[ContinuationInterceptor]
    println("[${Thread.currentThread().name}] [dispatcher: $dispatcher] $msg")
}

fun simple(): Flow<Int> = flow {
    log("Started simple flow")
    for (i in 1..3) {
        emit(i)
    }
}  

fun main() = runBlocking<Unit> {
    simple()
        .flowOn(Dispatchers.IO)
        .collect { value -> log("Collected $value") } 
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/CRpy6dOUW)

As the output below shows, the `flow` lambda upstream of `flowOn` runs on `Dispatchers.IO`, while the `collect` lambda runs on the main thread — the caller's context — demonstrating that Context Preservation is upheld.

```
[DefaultDispatcher-worker-1 @coroutine#2] [dispatcher: Dispatchers.IO] Started simple flow
[main @coroutine#1] [dispatcher: BlockingEventLoop@6615435c] Collected 1
[main @coroutine#1] [dispatcher: BlockingEventLoop@6615435c] Collected 2
[main @coroutine#1] [dispatcher: BlockingEventLoop@6615435c] Collected 3
```

Let's start with the source code of `flowOn`.

```kt
public fun <T> Flow<T>.flowOn(context: CoroutineContext): Flow<T> {
    checkFlowContext(context)
    return when {
        context == EmptyCoroutineContext -> this
        this is FusibleFlow -> fuse(context = context)
        else -> ChannelFlowOperatorImpl(this, context = context)
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/operators/Context.kt#L243-L250)

First, `checkFlowContext` is an assertion that verifies no `Job` is present in the `CoroutineContext`. A `Job` in the context is unexpected and would cause the coroutine to form a parent-child relationship with the `Job`'s coroutine.

```kt
private fun checkFlowContext(context: CoroutineContext) {
    require(context[Job] == null) {
        "Flow context cannot contain job in it. Had $context"
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/operators/Context.kt#L283-L287)

Next, `this is FusibleFlow -> fuse(context = context)` handles the case where `flowOn` or `buffer` has already been applied. In that case, `fuse()` merges the contexts without creating a new channel.

The `else -> ChannelFlowOperatorImpl(this, context = context)` branch is the default case. Let's look at `ChannelFlowOperatorImpl`, its base class `ChannelFlowOperator`, and `ChannelFlow`. The key part is `ChannelFlow`'s `collect`.

```kt
internal class ChannelFlowOperatorImpl<T>(
    flow: Flow<T>,
    context: CoroutineContext = EmptyCoroutineContext,
    capacity: Int = Channel.OPTIONAL_CHANNEL,
    onBufferOverflow: BufferOverflow = BufferOverflow.SUSPEND
) : ChannelFlowOperator<T, T>(flow, context, capacity, onBufferOverflow) {
    // omitted
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/643c1aa554139a82f60724a59e79b801f303fdfe/kotlinx-coroutines-core/common/src/flow/internal/ChannelFlow.kt#L179-L192)

```kt
internal abstract class ChannelFlowOperator<S, T>(
    @JvmField protected val flow: Flow<S>,
    context: CoroutineContext,
    capacity: Int,
    onBufferOverflow: BufferOverflow
) : ChannelFlow<T>(context, capacity, onBufferOverflow) {
    // omitted
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/643c1aa554139a82f60724a59e79b801f303fdfe/kotlinx-coroutines-core/common/src/flow/internal/ChannelFlow.kt#L136-L174)

```kt
public abstract class ChannelFlow<T>(
    // upstream context
    @JvmField public val context: CoroutineContext,
    // buffer capacity between upstream and downstream context
    @JvmField public val capacity: Int,
    // buffer overflow strategy
    @JvmField public val onBufferOverflow: BufferOverflow
) : FusibleFlow<T> {
    override suspend fun collect(collector: FlowCollector<T>): Unit =
        coroutineScope {
            collector.emitAll(produceImpl(this))
        }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/internal/ChannelFlow.kt#L42-L133)

`ChannelFlow`'s `produceImpl` runs the upstream processing in the `CoroutineContext` specified by `flowOn`.

```kt
    public open fun produceImpl(scope: CoroutineScope): ReceiveChannel<T> =
        scope.produce(context, produceCapacity, onBufferOverflow, start = CoroutineStart.ATOMIC, block = collectToFun)
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/internal/ChannelFlow.kt#L114-L115)

Specifically, `collectToFun` represents the call to upstream processing. The call chain is `ChannelFlow.collectToFun` → `ChannelFlowOperator.collectTo` → `ChannelFlowOperatorImpl.flowCollect`, eventually calling `collect` on the `Flow<T>` that is `flowOn`'s receiver (the upstream Flow).

```kt
internal class ChannelFlowOperatorImpl<T>(
    flow: Flow<T>,
    context: CoroutineContext = EmptyCoroutineContext,
    capacity: Int = Channel.OPTIONAL_CHANNEL,
    onBufferOverflow: BufferOverflow = BufferOverflow.SUSPEND
) : ChannelFlowOperator<T, T>(flow, context, capacity, onBufferOverflow) {
    // `flow` here is the receiver of `flowOn`.
    override suspend fun flowCollect(collector: FlowCollector<T>) =
        flow.collect(collector)
}
```

In the [previous article](/kotlin/coroutine-flow-internals-intermediate-operator/), I showed how each Intermediate Operator wraps the Flow in a new layer, and `collect` is called in a chain from downstream to upstream. The same is true for `flowOn`. When `collect` is called on the `Flow` (`ChannelFlow`) created by `flowOn`, it eventually calls `collect` on the upstream Flow. The key difference is that **when the upstream `collect` is called, it runs in the `CoroutineContext` passed as the argument to `flowOn`**. This is the mechanism behind the spec "flowOn switches the upstream execution context."

When `emit` is called upstream, `SendingCollector`'s `emit` is called, sending the value to the `SendChannel`.

```kt
public class SendingCollector<T>(
    private val channel: SendChannel<T>
) : FlowCollector<T> {
    override suspend fun emit(value: T): Unit = channel.send(value)
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/internal/SendingCollector.kt#L12-L16)

Returning to `ChannelFlow`'s `collect` implementation, `produceImpl` returns a `ReceiveChannel`. Through this `ReceiveChannel`, values sent to the `SendChannel` can be received.

```kt
    override suspend fun collect(collector: FlowCollector<T>): Unit =
        coroutineScope {
            collector.emitAll(produceImpl(this)) // `produceImpl` returns `ReceiveChannel`
        }
```

> For more on Kotlin Coroutines `Channel`, see the [official documentation](https://kotlinlang.org/docs/channels.html).

The `ReceiveChannel` is passed as an argument to `FlowCollector<T>.emitAll`.
Looking at the implementation, values flowing through the Channel (i.e., values emitted upstream) are `emit`ted to the downstream `FlowCollector` (i.e., the `collect` lambda is called). Since this processing inside `emitAll` runs in the execution context of the call to `collect` on `flowOn`'s Flow, Context Preservation is upheld.

```kt
public suspend fun <T> FlowCollector<T>.emitAll(channel: ReceiveChannel<T>): Unit =
    emitAllImpl(channel, consume = true)

private suspend fun <T> FlowCollector<T>.emitAllImpl(channel: ReceiveChannel<T>, consume: Boolean) {
    ensureActive()
    var cause: Throwable? = null
    try {
        for (element in channel) {
            emit(element) // 👈 emits each element in channel.
        }
    } catch (e: Throwable) {
        cause = e
        throw e
    } finally {
        if (consume) channel.cancelConsumed(cause)
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Channels.kt#L25-L41)

---

Let's summarize the flow in diagrams. First, `flowOn` creates and returns a `ChannelFlow`.

![](https://static.zenn.studio/user-upload/e43595c34890-20260426.png)
*`flowOn` creates a `ChannelFlow`*

When `collect` is called on the `ChannelFlow`, `collect` on the upstream Flow is called **in the `CoroutineContext` passed to `flowOn`**, and the lambda passed to `flow` is eventually executed.
The chained `collect` calls from downstream to upstream work the same way as with `map` or `filter`, but the key difference is that the execution context switches when the upstream `collect` is called.

![](https://static.zenn.studio/user-upload/a574a49ce3f4-20260426.png)
*`collect` is called in a chain from downstream to upstream*

When a value is `emit`ted inside `flow`, `SendingCollector`'s `emit` is called, sending the value into the Channel. All of this happens on `Dispatchers.IO`. Afterwards, back in the original execution context, the value is received via the Channel and the terminal `collect` lambda is called.
The chained `emit` calls from upstream to downstream are the same as with `map` or `filter`. What is important here is that values are passed via a Channel to return to the original execution context.

![](https://static.zenn.studio/user-upload/dd2ecde0298d-20260426.png)
*`emit` is called in a chain from upstream to downstream*

## How Violating Context Preservation Causes a Runtime Error

Finally, let's briefly look at the mechanism that causes a runtime error when Context Preservation is violated.

In the [first article](/kotlin/coroutine-flow-internals-basic/), I showed that the Flow Builder (`flow` function) creates an instance of `SafeFlow`.
(Something I glossed over in that article for simplicity:) Inside `SafeFlow`'s `collect`, the `FlowCollector` is wrapped in a class called `SafeCollector`.

```kt
// NOTE: SafeFlow extends AbstractFlow
public abstract class AbstractFlow<T> : Flow<T>, CancellableFlow<T> {
    public final override suspend fun collect(collector: FlowCollector<T>) {
        val safeCollector = SafeCollector(collector, coroutineContext)
        try {
            collectSafely(safeCollector)
        } finally {
            safeCollector.releaseIntercepted()
        }
    }
}
```
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Flow.kt#L221-L230)

When `SafeCollector`'s `emit` is called, it validates the execution context before calling `emit` on the wrapped `FlowCollector`. Note that `SafeCollector`'s implementation differs per platform; the following is the JVM implementation.

```kt
    private fun emit(uCont: Continuation<Unit>, value: T): Any? {
        val currentContext = uCont.context
        currentContext.ensureActive()
        // This check is triggered once per flow on a happy path.
        val previousContext = lastEmissionContext
        if (previousContext !== currentContext) {
            // 👇 Execution context validation
            checkContext(currentContext, previousContext, value)
            lastEmissionContext = currentContext
        }
        completion_ = uCont
        // 👇 `FlowCollector`'s `emit` is called.
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
[**View on GitHub**](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/jvm/src/flow/internal/SafeCollector.kt#L103-L122)

The runtime check for Context Preservation works as follows: the `FlowCollector` passed to `SafeFlow`'s `collect` is wrapped in a `SafeCollector`, and validation is performed each time `emit` is called.

## Summary

In this article, I decoded the mechanism by which `flowOn` switches execution contexts from its internal implementation. The two key points are:

1. When `collect` is called from downstream to upstream, it runs in the `CoroutineContext` passed to `flowOn`.
2. When values are passed from upstream to downstream via `emit`, they travel through a Channel, allowing them to be received back in the original execution context.
