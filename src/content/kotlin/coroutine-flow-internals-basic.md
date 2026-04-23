---
title: "Understanding Kotlin Coroutines Flow Internals: Flow Builder, emit, and collect"
description: "A deep dive into the internal implementation of Kotlin Coroutines Flow, explaining how flow {}, emit, and collect work under the hood."
pubDate: 2026-04-22
tags: ["kotlin", "android", "coroutines", "kotlin-coroutines-flow"]
---

> **Japanese version:** This article is also available in Japanese on [Zenn](https://zenn.dev/kaseken/articles/aa47be76ffba9d).

**Kotlin Coroutines Flow** is now widely used in both Android app development and server-side Kotlin. Yet, many developers use it without fully understanding how it works internally.

In this article, we will decode the internal implementation of Flow from its source code.
The primary audience is intermediate developers who know the basic specs of Flow and use it in production, but treat it as a black box. The goal is to help readers build a mental model of what happens under the hood, enabling them to implement, debug, and review Flow-based code more effectively and with greater confidence.

For an overview of Kotlin Coroutines internals, please refer to my talk at Kotlin Fest 2025.

<div style="display: flex; justify-content: center;">
<iframe width="560" height="315" src="https://www.youtube.com/embed/oIaL8X8q2Gk?si=X-ALvSjgcolnsLIj" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div>

> **Note:** The version of `kotlinx.coroutines`[^1] used in this article is [v1.10.2](https://github.com/Kotlin/kotlinx.coroutines/releases/tag/1.10.2), the latest version at the time of writing.

## Looking at the Flow Sample Code

The first sample code that appears in the official Kotlin documentation for Flow[^2] looks like this:

```kt
fun simple(): Flow<Int> = flow { // flow builder
    println("Flow started")
    for (i in 1..3) {
        delay(100) // pretend we are doing something useful here
        emit(i) // emit next value
    }
}

fun main() = runBlocking<Unit> {
    // Launch a concurrent coroutine to check if the main thread is blocked
    launch {
        for (k in 1..3) {
            println("I'm not blocked $k")
            delay(100)
        }
    }
    // Collect the flow
    println("Calling collect...")
    simple().collect { value -> println(value) } 
}
```

[**▶️ Run in Playground**](https://pl.kotl.in/kZ5MMbwGu)

Running this code produces the following output. 

```
Calling collect...
Flow started
I'm not blocked 1
1
I'm not blocked 2
2
I'm not blocked 3
3
```

We can see that values are emitted every 100ms, and the execution thread is not blocked.
Also, notice that "Flow started" is printed *after* "Calling collect...", which tells us that the processing inside `flow` only begins after `collect` is called. A Flow that does not start processing until a **Terminal Operator** such as `collect` is called is known as a **Cold Flow**.

This behavior is fundamental knowledge that most Kotlin engineers are familiar with.
But can you explain *why* this behavior occurs under the hood?
In the following sections, we will decode the internal implementation of three key functions — `flow`, `emit`, and `collect` — to reveal the mechanism behind it.

## Internal Implementation of the Flow Builder (`flow` function)

Functions used to create a Flow are called **Flow Builders**. The `flow {}` seen in the sample code above is one type of Flow Builder.

Here is the implementation of the `flow` function:

```kt
public fun <T> flow(@BuilderInference block: suspend FlowCollector<T>.() -> Unit): Flow<T> = SafeFlow(block)
```
[View source on GitHub](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Builders.kt#L52)

The `flow` function itself is simple: it takes a `block` argument and uses it to create and return an instance of the `SafeFlow` class (we'll cover `SafeFlow` shortly).
What's worth focusing on is the signature of the `block` parameter: `@BuilderInference block: suspend FlowCollector<T>.() -> Unit`.

#### The `suspend FlowCollector<T>.() -> Unit` part:

Kotlin has a concept called **Function Type with Receiver**[^3], written as `Receiver.(T1) -> ReturnValue`. Inside such a lambda, the receiver object is accessible as `this`. Here's a simple example:

```kt
data class User(val name: String)

// A function type with receiver where User is the receiver — the User object becomes `this`.
val greet: User.(Int) -> String = { times -> "${this.name}, ${"Hello!".repeat(times)}" }

fun main() {
    println(User("Kotlin").greet(3)) // Kotlin, Hello!Hello!Hello!
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/dJGqqBmkO)

Back to the `flow` function: `block` is a lambda of type `suspend FlowCollector<T>.() -> Unit` — a suspend function with `FlowCollector<T>` as its receiver. Because `block` is a **suspend function**, it can call other suspend functions such as `emit` and `delay` inside it.

#### The `@BuilderInference` part:

> **Warning:** As of Kotlin 2.0, `@BuilderInference` is deprecated. Builder type inference is now enabled automatically.

`@BuilderInference` is an annotation that enables a compiler feature called **builder type inference**[^4].

A builder function is a function that **accepts a lambda with a receiver and assembles an object to return**.
Here's an example. `buildBox` is a builder function that creates a `Box<T>`, accepting `Box<T>.() -> Unit` as its lambda. Builder type inference means **inferring the type parameter (T) of the builder function from the function calls inside the lambda**. In the example below, `T` is inferred as `String` from `add("hello")` inside the lambda.

```kt
import kotlin.experimental.ExperimentalTypeInference

class Box<T> {
    val items = mutableListOf<T>()
    fun add(item: T) { items.add(item) }
}

// NOTE: Before Kotlin 2.0, @BuilderInference was required to infer T.
@OptIn(ExperimentalTypeInference::class)
fun <T> buildBox(@BuilderInference block: Box<T>.() -> Unit): Box<T> = Box<T>().apply(block)

fun main() {
    val stringBox = buildBox {
        add("hello") // T inferred as String from add("hello")
        add("world")
    }
    println(stringBox.items) // [hello, world]
    val intBox = buildBox {
        add(1) // T inferred as Int from add(1)
        add(2)
    }
    println(intBox.items) // [1, 2]
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/-mhmmAqKN)

Back to the `flow` function: thanks to builder type inference, the type `T` in `Flow<T>` is inferred from the type of the value passed to `emit` inside `flow {}`.

```kt
val f = flow {
    emit(42) // T inferred as Int → f: Flow<Int>
}
```

To summarize so far: **the `flow` function is a builder function for `Flow<T>`, and it uses a function type with receiver — `suspend FlowCollector<T>.() -> Unit` — to assemble the `Flow<T>`.**
Next, let's look at what `FlowCollector` is.

## Internal Implementation of `FlowCollector`

Here is the implementation of `FlowCollector`:

```kt
public fun interface FlowCollector<in T> {
    /**
     * Collects the value emitted by the upstream.
     * This method is not thread-safe and should not be invoked concurrently.
     */
    public suspend fun emit(value: T)
}
```
[View source on GitHub](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/FlowCollector.kt#L25-L32)

`FlowCollector` is a **Functional Interface** (also known as a **Single Abstract Method (SAM) interface**)[^5].
A functional interface contains exactly one abstract method and is declared using `fun interface`.

One key characteristic of functional interfaces is that they can be instantiated concisely using a lambda, through a mechanism called **SAM conversion**.
As shown below, when passing a `FlowCollector<T>`, you can simply pass a lambda — it will be treated as the implementation of the `emit` function.

```kt
fun <T>f(collector: FlowCollector<T>) {}

fun main() {
    // Explicit definition
    f(object: FlowCollector<Int> {
        override suspend fun emit(value: Int) {
            println(value)
        }
    })
    // Using SAM conversion
    f { value: Int -> println(value) } // the lambda is treated as the emit implementation
}
```

To understand what `FlowCollector` is for, we need to look at `Flow` itself.
`Flow` is an interface with **only one function: `collect`**.

```kt
public interface Flow<out T> {
    public suspend fun collect(collector: FlowCollector<T>)
}
```
[View source on GitHub](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Flow.kt#L176-L195)

The `collect` function takes a `FlowCollector` as its argument.
This means that passing a lambda to `collect` is equivalent to explicitly constructing a `FlowCollector`, as shown below:

```kt
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

fun simple(): Flow<Int> = flow {
    for (i in 1..3) {
        delay(100)
        emit(i)
    }
}

fun main() = runBlocking<Unit> {
    // Equivalent to: simple().collect { value -> println(value) }
    simple().collect(object: FlowCollector<Int> {
        override suspend fun emit(value: Int) {
            println(value)
        }
    })
}
```
[**▶️ Run in Playground**](https://pl.kotl.in/lPxguNayN)

At this point, a hypothesis may come to mind:
**Could `emit` called inside the Flow Builder (`flow` function) actually be calling the lambda passed to `collect` (i.e., `FlowCollector`'s `emit`)?**
To verify this, let's finally look at the `SafeFlow` implementation we set aside earlier.

![How emit is called from the Flow Builder](/images/coroutine-flow-internals/flow-emit-call.png)

## Revisiting the Internal Implementation of `flow`

As a reminder, the `flow` function takes a `block` argument and returns an instance of `SafeFlow`.

```kt
public fun <T> flow(@BuilderInference block: suspend FlowCollector<T>.() -> Unit): Flow<T> = SafeFlow(block)
```
[View source on GitHub](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Builders.kt#L52)

Looking at the `SafeFlow` implementation, we find a `collectSafely` function.
In `collectSafely`, a `FlowCollector` is received, and `block` (the lambda with `FlowCollector` as its receiver) is invoked.

```kt
private class SafeFlow<T>(private val block: suspend FlowCollector<T>.() -> Unit) : AbstractFlow<T>() {
    override suspend fun collectSafely(collector: FlowCollector<T>) {
        collector.block()
    }
}
```
[View source on GitHub](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Builders.kt#L55-L59)

`SafeFlow<T>` extends `AbstractFlow<T>`. Here is the source of `AbstractFlow`:

```kt
public abstract class AbstractFlow<T> : Flow<T>, CancellableFlow<T> {
    public final override suspend fun collect(collector: FlowCollector<T>) {
        val safeCollector = SafeCollector(collector, coroutineContext)
        try {
            collectSafely(safeCollector)
        } finally {
            safeCollector.releaseIntercepted()
        }
    }

    public abstract suspend fun collectSafely(collector: FlowCollector<T>)
}
```
[View source on GitHub](https://github.com/Kotlin/kotlinx.coroutines/blob/5f8900478a8e20c073145b1608fbc71fe3d7378b/kotlinx-coroutines-core/common/src/flow/Flow.kt#L221-L246)

Inside `AbstractFlow`'s `collect`, `collectSafely` is called.
In other words, when `collect` is called on a `SafeFlow`, `collectSafely` is called, and **`block` (the lambda passed to `flow`) is executed with the `FlowCollector` passed to `collect` as its receiver**.

Let's walk through the sample code step by step. First, the `flow` function (a Flow Builder) creates a `SafeFlow`. This `SafeFlow` holds the lambda (`block`) passed to `flow`.

![① Until SafeFlow is created](/images/coroutine-flow-internals/safe-flow-creation.png)

Next, when `collect` is called, the lambda (`block`) passed to `flow` is executed with the `FlowCollector` passed to `collect` as its receiver.

![② After collect is called](/images/coroutine-flow-internals/after-collect.png)

Finally, **when `emit` is called inside `flow {}`, `FlowCollector`'s `emit` is executed** — which, when using SAM conversion, is the lambda passed to `collect`. This confirms our earlier hypothesis.

![③ After emit is called](/images/coroutine-flow-internals/after-emit.png)

With this, the relationship and mechanics of the Flow Builder, `emit`, and `collect` should now be clear.
The specification that "Cold Flow does not execute until `collect` is called" can also be explained from this internal implementation: as we can see from `AbstractFlow` and `SafeFlow`, it is only when `collect` is called that the lambda (`block`) passed to `flow` is actually executed.

## Summary

In this article, we revealed the internal implementation of the three core functions of Kotlin Coroutines Flow: the Flow Builder (`flow {}`), `emit`, and `collect`. Hopefully, you now have a clear mental model of how basic Cold Flow works under the hood.

That said, there is much more to Flow. The following topics will each be covered in separate future articles:

- **[How Intermediate Flow Operators like `map` work internally](/kotlin/coroutine-flow-internals-intermediate-operator/)**
- **How Hot Flow works internally**
- **How context switching with `flowOn` works**
- **How Buffering and Conflation work**
- **Flow cancellation mechanism**
- **Flow error handling mechanism**

[^1]: `Kotlin/kotlinx.coroutines`: https://github.com/Kotlin/kotlinx.coroutines
[^2]: Flow sample code in Kotlin docs: https://kotlinlang.org/docs/flow.html#flows
[^3]: Function literals with receiver: https://kotlinlang.org/docs/lambdas.html#function-literals-with-receiver
[^4]: Using builders with builder type inference: https://kotlinlang.org/docs/using-builders-with-builder-inference.html
[^5]: Functional (SAM) interfaces: https://kotlinlang.org/docs/fun-interfaces.html
