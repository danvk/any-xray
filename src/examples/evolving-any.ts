// See https://github.com/danvk/any-xray/issues/1
// and https://effectivetypescript.com/2020/03/09/evolving-any/

function evolvingAnyUndefined() {
  let val; // Type is any
  if (Math.random() < 0.5) {
    val = /hello/;
    val; // Type is RegExp
  } else {
    val = 12;
    val; // Type is number
  }
  val; // Type is number | RegExp
}

function evolvingAnyNull() {
  let val = null; // Type is any
  try {
    val = 12;
    val; // Type is number
  } catch (e) {
    console.warn("alas!");
  }
  val; // Type is number | null
}
