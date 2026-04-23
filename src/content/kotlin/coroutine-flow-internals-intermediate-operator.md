---
title: "Understanding Kotlin Coroutines Flow Internals: How map and filter Work"
description: "A deep dive into the internal implementation of Kotlin Coroutines Flow intermediate operators (map and filter), decoded from the kotlinx.coroutines library source code."
pubDate: 2026-04-23
tags: ["kotlin", "coroutines", "concurrency", "flow", "async"]
---

> **Japanese version:** This article is also available in Japanese on [Zenn](https://zenn.dev/kaseken/articles/996ac7395900ec).

In the [previous article](/kotlin/coroutine-flow-internals-basic/), I decoded the mechanisms of Flow Builder (`flow`), `emit`, and `collect` in a sample Kotlin Coroutines Flow code like the one below, by reading through the `kotlinx.coroutines` library source code. If you haven't read it yet, I recommend checking it out.

```kt
fun simple(): Flow<Int> = flow {
    for (i in 1..3) {
        delay(100)
        emit(i)
    }
}

fun main() = runBlocking<Unit> {
    simple().collect { value -> println(value) }
}
```

## Quick Recap

In the previous article, we clarified the mechanisms and relationships of Flow Builder (`flow`), `emit`, and `collect`.

1. Flow Builder (`flow`) creates an instance of `SafeFlow`. `SafeFlow` holds the `block` (a lambda with `FlowCollector` as receiver) passed to `flow`.
2. When `collect` is called on `SafeFlow`, the `block` is executed with the `FlowCollector` passed to `collect` as its receiver.
3. Inside `block`, the `emit` function defined in `FlowCollector` is called. Note that when a lambda is passed to `collect`, that lambda is treated as the `emit` function via SAM conversion.

In other words, **every time `emit` is called inside `flow {}`, the lambda passed to `collect` is executed**.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/59b380fa25f7-20260420.png" alt="Flow Builder (flow), emit, and collect — mechanisms and relationships" style="max-width: 600px; width: 100%;" />
<em>Flow Builder (<code>flow</code>), <code>emit</code>, and <code>collect</code> — mechanisms and relationships</em>
</div>

> **Note:** If the above explanation is unclear, the [previous article](/kotlin/coroutine-flow-internals-basic/) covers it in more detail.

In this article, as an extension of the previous one, we will decode the behind-the-scenes mechanism when Intermediate Operators such as `map` and `filter` are present.

```kt
fun simple(): Flow<Int> = flow {
    for (i in 1..5) {
        delay(100)
        emit(i)
    }
}

fun Int.isEven() = this % 2 == 0

fun main() = runBlocking<Unit> {
    simple()
        .filter { it.isEven() } // 2, 4
        .map { it * 2 }         // 4, 8
        .collect { value -> println(value) }
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/B64K77DHA)

## Internal Implementation of `map`

Let's look at `map`, a representative example of an Intermediate Operator.
`map` is a function that applies some transformation to each value in a Flow. The transformation is defined by the lambda passed to `map`. The source code for `map` is shown below.

```kt
public inline fun <T, R> Flow<T>.map(crossinline transform: suspend (value: T) -> R): Flow<R> = transform { value ->
    return@transform emit(transform(value))
}
```
[kotlinx.coroutines — Transform.kt L49-L51](https://github.com/Kotlin/kotlinx.coroutines/blob/643c1aa554139a82f60724a59e79b801f303fdfe/kotlinx-coroutines-core/common/src/flow/operators/Transform.kt#L49-L51)

The return type is `Flow<R>`, which tells us that each element's type is converted from `T` to `R`.
It also takes `crossinline transform: suspend (value: T) -> R` as an argument — this is the lambda that defines the `T`-to-`R` transformation.

Here things get slightly confusing, because there are two different things called `transform`:
1. The argument lambda representing the transformation logic (`suspend (value: T) -> R`)
2. The `Flow<T>.unsafeTransform` extension function on `Flow`, imported as `import kotlinx.coroutines.flow.unsafeTransform as transform`

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/b2b7759c75ac-20260421.png" alt="The two distinct meanings of transform" style="width: 100%;" />
<em>The two different <code>transform</code>s</em>
</div>

Inside `map`, the argument `transform` is called within the lambda passed to `unsafeTransform` (the second `transform`). The source code for `unsafeTransform` is shown below.

```kt
@PublishedApi
internal inline fun <T, R> Flow<T>.unsafeTransform(
    crossinline transform: suspend FlowCollector<R>.(value: T) -> Unit
): Flow<R> = unsafeFlow { // Note: unsafe flow is used here, because unsafeTransform is only for internal use
    collect { value ->
        transform(value)
    }
}
```
[kotlinx.coroutines — Emitters.kt L42-L49](https://github.com/Kotlin/kotlinx.coroutines/blob/643c1aa554139a82f60724a59e79b801f303fdfe/kotlinx-coroutines-core/common/src/flow/operators/Emitters.kt#L42-L49)

A function called `unsafeFlow` is used here. Like `flow`, this is a **type of Flow Builder**. Looking at the source code for `unsafeFlow`, it returns an anonymous object conforming to the `Flow<T>` interface.

```kt
internal inline fun <T> unsafeFlow(crossinline block: suspend FlowCollector<T>.() -> Unit): Flow<T> {
    return object : Flow<T> {
        override suspend fun collect(collector: FlowCollector<T>) {
            collector.block()
        }
    }
}
```
[kotlinx.coroutines — SafeCollector.common.kt L103-L110](https://github.com/Kotlin/kotlinx.coroutines/blob/643c1aa554139a82f60724a59e79b801f303fdfe/kotlinx-coroutines-core/common/src/flow/internal/SafeCollector.common.kt#L103-L110)

> **Note:** The `unsafe` prefix is used because, unlike `flow`, the runtime check that verifies the execution context is correct is omitted.

Since this is getting complex, let me rewrite the `map` function with `unsafeTransform` and `unsafeFlow` expanded for clarity:

```kt
// Original implementation
// public inline fun <T, R> Flow<T>.map(crossinline transform: suspend (value: T) -> R): Flow<R> = transform { value ->
//     return@transform emit(transform(value))
// }

public inline fun <T, R> Flow<T>.map(
    crossinline transform: suspend (value: T) -> R
): Flow<R> = object : Flow<R> {
    override suspend fun collect(collector: FlowCollector<R>) {
        collector.run {
            this@map.collect { value ->
                emit(transform(value))
            }
        }
    }
}
```

Let me walk through the expanded implementation step by step. First, `map` creates and returns a new anonymous object of type `Flow<R>`.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/8f069de0a4fc-20260421.png" alt="Creating a new anonymous object of type Flow<R>" style="max-width: 600px; width: 100%;" />
<em>Creating the <code>Flow&lt;R&gt;</code> anonymous object</em>
</div>

Inside the `collect` function of the `Flow<R>` returned by `map`, the `collect` of the upstream `Flow<T>` (i.e., the receiver of `map`) is called first.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/01c8eee8c686-20260421.png" alt="Calling collect on Flow<T>" style="max-width: 600px; width: 100%;" />
<em>Calling <code>collect</code> on <code>Flow&lt;T&gt;</code></em>
</div>

From `Flow<T>`'s `collect`, the lambda (`block`) passed to the Flow Builder (`flow`) is called. When `emit` is called inside that lambda, the value is first transformed by `transform`, and then `emit` on the `FlowCollector<R>` passed to `Flow<R>`'s `collect` is called.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/7a0254921ea0-20260421.png" alt="Applying transform and calling emit on FlowCollector<R>" style="max-width: 600px; width: 100%;" />
<em>Applying <code>transform</code> and calling <code>emit</code> on <code>FlowCollector&lt;R&gt;</code></em>
</div>

Let's now walk through the overall flow using the following sample code:

```kt
fun simple(): Flow<Int> = flow {
    for (i in 1..3) {
        delay(100)
        emit(i)
    }
}

fun main() = runBlocking<Unit> {
    simple()
        .map { "${it * 2}!" } // "2!", "4!", "6!"
        .collect { value -> println(value) }
}
```

First, `flow` creates a `SafeFlow<Int>`.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/e0993431766a-20260421.png" alt="Creating SafeFlow<Int>" style="max-width: 600px; width: 100%;" />
<em>Creating <code>SafeFlow&lt;Int&gt;</code></em>
</div>

Next, `map` creates a `Flow<String>`.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/8d9dc1465df2-20260421.png" alt="Creating Flow<String>" style="max-width: 600px; width: 100%;" />
<em>Creating <code>Flow&lt;String&gt;</code></em>
</div>

`collect` is called on `Flow<String>`, which in turn calls `collect` on `Flow<Int>`.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/3b1881f2e226-20260421.png" alt="Flow<String>'s collect triggers Flow<Int>'s collect" style="max-width: 600px; width: 100%;" />
<em><code>Flow&lt;String&gt;</code>'s <code>collect</code> → <code>Flow&lt;Int&gt;</code>'s <code>collect</code></em>
</div>

From `Flow<Int>`'s `collect`, the lambda (`block`) passed to the original `flow` is executed. When `emit` is called inside `block`, the lambda passed to `Flow<Int>`'s `collect` (i.e., `FlowCollector<Int>`'s `emit`) is called.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/2dac9c6528a5-20260421.png" alt="Executing flow's lambda and calling FlowCollector<Int>'s emit" style="max-width: 600px; width: 100%;" />
<em>Executing <code>flow</code>'s lambda and calling <code>FlowCollector&lt;Int&gt;</code>'s <code>emit</code></em>
</div>

Finally, after `transform` is applied to the upstream value (`value`), `FlowCollector<String>`'s `emit` (= the lambda passed to the terminal `collect`) is called.

<div style="display: flex; flex-direction: column; align-items: center; margin: 1rem 0;">
<img src="/images/coroutine-flow-internals-intermediate-operator/533a740e3b8f-20260421.png" alt="Applying transform and calling FlowCollector<String>'s emit" style="max-width: 600px; width: 100%;" />
<em>Applying <code>transform</code> and calling <code>FlowCollector&lt;String&gt;</code>'s <code>emit</code></em>
</div>

To summarize the execution order: `Flow<String>`'s `collect` → `Flow<Int>`'s `collect` → `FlowCollector<Int>`'s `emit` → `FlowCollector<String>`'s `emit`. The same pattern applies when multiple Intermediate Operators are present.

We have now decoded the internal mechanism of `map` from its source code. The three key points are:

- **Each time `map` is applied, a new `Flow<R>` is created.**
- **When the terminal `.collect` is called, `collect` is called sequentially from downstream to upstream. Then, each time a value is `emit`ted inside the original `flow {}`, `emit` on `FlowCollector` is called sequentially from upstream to downstream, ultimately calling the lambda passed to the terminal `collect`.**
- **Just before passing a value to the downstream `FlowCollector`'s `emit`, the value is transformed by `transform`.**

## Internal Implementation of `filter`

As another example, let's look at the internal implementation of `filter`. Looking at its source code, we can see it is implemented using `unsafeTransform`, just like `map`.

```kt
public inline fun <T> Flow<T>.filter(crossinline predicate: suspend (T) -> Boolean): Flow<T> = transform { value ->
    if (predicate(value)) return@transform emit(value)
}
```
[kotlinx.coroutines — Transform.kt L17-L19](https://github.com/Kotlin/kotlinx.coroutines/blob/643c1aa554139a82f60724a59e79b801f303fdfe/kotlinx-coroutines-core/common/src/flow/operators/Transform.kt#L17-L19)

As with `map`, here is the expanded code with `unsafeTransform` inlined for clarity.
The difference from `map` is that instead of `emit(transform(value))`, it uses `if (predicate(value)) emit(value)` — only `emit`ting values to the downstream `FlowCollector<T>` that satisfy the condition lambda (`predicate`).

```kt
public inline fun <T> Flow<T>.filter(
    crossinline predicate: suspend (T) -> Boolean
): Flow<T> = object : Flow<T> {
    override suspend fun collect(collector: FlowCollector<T>) {
        collector.run {
            this@filter.collect { value ->
                if (predicate(value)) emit(value) // 💡 Difference from `map`
            }
        }
    }
}
```

## Summary

In this article, we decoded the mechanisms of two fundamental Intermediate Operators — `map` and `filter` — from the source code. The three key points are:

- **Each time `map` or `filter` is applied, a new `Flow` is created.**
- **When the terminal `.collect` is called, `collect` is called sequentially from downstream to upstream. Then, each time a value is `emit`ted inside the original `flow {}`, `emit` on `FlowCollector` is called sequentially from upstream to downstream, ultimately calling the lambda passed to the terminal `collect`.**
- **Just before passing a value to the downstream `FlowCollector`'s `emit`, `map` applies a transformation, while `filter` performs a conditional branch to decide whether to `emit` the value.**

That said, there are many other types of Intermediate Operators:

- More advanced operations like `take` and `debounce`
- Buffering operators like `buffer` and `conflate`
- Context-switching operators like `flowOn`
- Error-handling operators like `catch`

I plan to cover other Intermediate Operators in future articles.
